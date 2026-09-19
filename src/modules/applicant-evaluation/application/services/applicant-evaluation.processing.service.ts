import { err, ok, Result } from 'neverthrow';
import { IApplicantEvaluationProcessingService } from '../interfaces/applicant-evaluation-processing.service.interface';
import { IApplicantEvaluationRepository } from '../../domain/repositories/applicant-evaluation.repo.interface';
import { IApplicantEvaluationLlm } from '../interfaces/applicant-evaluation-llm.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';

export class ApplicantEvaluationProcessingService implements IApplicantEvaluationProcessingService {
  constructor(
    private readonly applicantEvaluationRepo: IApplicantEvaluationRepository,
    private readonly llmEvaluator: IApplicantEvaluationLlm,
  ) {}
  async process(evaluationPublicId: string): Promise<Result<undefined, Error>> {
    try {
      const evaluationData =
        await this.applicantEvaluationRepo.claimForProcessing(
          evaluationPublicId,
        );
      if (evaluationData.isErr()) {
        return err(new Error('Failed to claim evaluation for processing'));
      }
      if (!evaluationData.value)
        return err(new AppError(ErrorCode.NotFound, 'Evaluation not found'));
      const llmResponse = await this.llmEvaluator.evaluate({
        jobSnapshot: evaluationData.value.jobSnapshot,
        resumeText: evaluationData.value.resumeText,
      });
      if (llmResponse.isErr()) {
        return err(new Error('Failed to evaluate applicant'));
      }
      const output = llmResponse.value;
      const completed = await this.applicantEvaluationRepo.markCompleted({
        evaluationPublicId,
        overallScore: output.overallScore,
        scoreBreakdown: output.scoreBreakdown,
        evidence: output.evidence,
      });
      if (completed.isErr()) {
        return err(new Error('Failed to mark evaluation as completed'));
      }
      if (!completed.value) {
        return err(new Error('Nothing needs to be completed'));
      }
      return ok(undefined);
    } catch (error) {
      await this.applicantEvaluationRepo.markPending(
        evaluationPublicId,
        `Failed to process evaluation: ${error}`,
      );
      return err(new Error(`Failed to process evaluation: ${error}`));
    }
  }
}
