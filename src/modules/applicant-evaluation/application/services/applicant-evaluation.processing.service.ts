import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { IApplicantEvaluationRepository } from '../../domain/repositories/applicant-evaluation.repo.interface';
import { IApplicantEvaluationLlm } from '../interfaces/applicant-evaluation-llm.interface';
import { IApplicantEvaluationNotifier } from '../interfaces/applicant-evaluation-notifier.interface';
import { IApplicantEvaluationProcessingService } from '../interfaces/applicant-evaluation-processing.service.interface';
import {
  validateApplicantEvaluationOutput,
  validateApplicantEvaluationOutputV2,
} from '../../infrastructure/llm/applicant-evaluation-response.validator';
import {
  resolveEvaluationV2EvidenceOffsets,
  validateEvaluationV2,
} from './evaluation-v2-validator';

@Injectable()
export class ApplicantEvaluationProcessingService implements IApplicantEvaluationProcessingService {
  constructor(
    private readonly applicantEvaluationRepo: IApplicantEvaluationRepository,
    private readonly llmEvaluator: IApplicantEvaluationLlm,
    private readonly notifier: IApplicantEvaluationNotifier,
  ) {}

  async process(
    evaluationPublicId: string,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<Result<undefined, Error>> {
    const evaluationData =
      await this.applicantEvaluationRepo.claimForProcessing(evaluationPublicId);
    if (evaluationData.isErr()) {
      return this.handleFailure(
        evaluationPublicId,
        evaluationData.error,
        attemptsMade,
        maxAttempts,
      );
    }

    // A terminal or concurrently claimed evaluation is already handled.
    if (!evaluationData.value) {
      return ok(undefined);
    }

    const llmResponse = await this.llmEvaluator.evaluate({
      jobSnapshot: evaluationData.value.jobSnapshot,
      resumeText: evaluationData.value.resumeRedactedText,
      ...(evaluationData.value.demo ? { demo: true } : {}),
      model: evaluationData.value.model,
      promptVersion: evaluationData.value.promptVersion,
    });
    if (llmResponse.isErr()) {
      return this.handleFailure(
        evaluationPublicId,
        llmResponse.error,
        attemptsMade,
        maxAttempts,
      );
    }

    const output = llmResponse.value;
    const validate =
      output.schemaVersion === 2
        ? validateApplicantEvaluationOutputV2(output)
        : validateApplicantEvaluationOutput(output);
    if (!validate) {
      return this.handleFailure(
        evaluationPublicId,
        new Error('LLM returned an invalid evaluation response'),
        attemptsMade,
        maxAttempts,
      );
    }

    let completion;
    if (output.schemaVersion === 2) {
      const snapshot = evaluationData.value.jobSnapshot;
      if (snapshot.schemaVersion !== 2) {
        return this.handleFailure(
          evaluationPublicId,
          new Error('Invalid evaluation V2 response'),
          attemptsMade,
          maxAttempts,
        );
      }
      try {
        const validated = validateEvaluationV2(
          snapshot.criteria,
          evaluationData.value.resumeRedactedText,
          resolveEvaluationV2EvidenceOffsets(
            evaluationData.value.resumeRedactedText,
            output.evidence,
          ),
        );
        completion = { evaluationPublicId, ...validated };
      } catch (error) {
        return this.handleFailure(
          evaluationPublicId,
          new Error('Invalid evaluation V2 response', { cause: error }),
          attemptsMade,
          maxAttempts,
        );
      }
    } else {
      completion = {
        evaluationPublicId,
        overallScore: output.overallScore,
        scoreBreakdown: output.scoreBreakdown,
        evidence: output.evidence,
      };
    }

    const completed =
      await this.applicantEvaluationRepo.markCompleted(completion);
    if (completed.isErr()) {
      return this.handleFailure(
        evaluationPublicId,
        completed.error,
        attemptsMade,
        maxAttempts,
      );
    }

    // Another worker may have completed or failed it first.
    if (!completed.value) {
      return ok(undefined);
    }

    // call socket.io to notify the client.
    await this.notifier.notify({
      evaluationPublicId,
      status: CommonEvaluationStatus.COMPLETED,
      overallScore: completion.overallScore,
      updatedAt: new Date().toISOString(),
    });
    return ok(undefined);
  }

  private async handleFailure(
    evaluationPublicId: string,
    cause: unknown,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<Result<undefined, Error>> {
    const error = this.toError(cause);
    const isFinalAttempt = attemptsMade + 1 >= Math.max(1, maxAttempts);
    const transition = isFinalAttempt
      ? await this.applicantEvaluationRepo.markFailed(
          evaluationPublicId,
          error.message,
        )
      : await this.applicantEvaluationRepo.markPending(
          evaluationPublicId,
          error.message,
        );

    if (transition.isErr()) {
      return err(
        new Error(
          `${error.message}; failed to persist evaluation failure state: ${transition.error.message}`,
          { cause: error },
        ),
      );
    }

    // A concurrent worker may already have moved the evaluation to a
    // terminal state, in which case this attempt has nothing left to retry.
    if (!transition.value) {
      return ok(undefined);
    }

    await this.notifier.notify({
      evaluationPublicId,
      status: isFinalAttempt
        ? CommonEvaluationStatus.FAILED
        : CommonEvaluationStatus.PENDING,
      errorMessage: error.message,
      updatedAt: new Date().toISOString(),
    });

    return err(error);
  }

  private toError(cause: unknown): Error {
    return cause instanceof Error ? cause : new Error(String(cause), { cause });
  }
}
