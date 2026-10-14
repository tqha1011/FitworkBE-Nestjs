import { Injectable, Optional } from '@nestjs/common';
import { IDemoRepository } from 'src/modules/demo/domain/demo.repo.interface';
import { DemoAccessService } from 'src/modules/demo/application/demo-access.service';
import { demoMetrics } from 'src/modules/demo/domain/demo-metrics';
import { ConfigService } from '@nestjs/config';
import { IApplicantEvaluationService } from '../interfaces/applicant-evaluation.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CreateApplicantEvaluationRequestDto } from '../dtos/applicant-evaluation.request.dto';
import { IResumeContentRepository } from 'src/modules/resume/domain/repositories/resume-content.repo.interface';
import { IJobRepository } from 'src/modules/job/domain/repositories/job.repo.interface';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { IApplicantEvaluationQueueInterface } from '../interfaces/applicant-evaluation.queue.interface';
import { IApplicantEvaluationRepository } from '../../domain/repositories/applicant-evaluation.repo.interface';
import {
  CommonEvaluationStatus,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import {
  APPLICANT_EVALUATION_PROMPT_VERSION,
  APPLICANT_EVALUATION_PROMPT_VERSION_V2,
} from '../constants/applicant-evaluation.constants';
import {
  ApplicantEvaluationDetailDto,
  ApplicantEvaluationForJobOwnerDto,
  ApplicantEvaluationResponseDto,
} from '../dtos/applicant-evaluation.response.dto';
import { Logger } from '@nestjs/common';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { buildJobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { IResumeRedactEvaluation } from '../interfaces/resume-redact-evaluation.interface';

@Injectable()
export class ApplicantEvaluationService implements IApplicantEvaluationService {
  private readonly logger = new Logger(ApplicantEvaluationService.name);
  constructor(
    private readonly resumeContentRepository: IResumeContentRepository,
    private readonly jobRepository: IJobRepository,
    private readonly applicantEvaluationRepository: IApplicantEvaluationRepository,
    private readonly applicantEvaluationQueue: IApplicantEvaluationQueueInterface,
    private readonly configService: ConfigService,
    private readonly cacheManager: IApplicationCache,
    private readonly resumeRedaction: IResumeRedactEvaluation,
    @Optional() private readonly demoRepo?: IDemoRepository,
    @Optional() private readonly demoAccess?: DemoAccessService,
  ) {}
  async getApplicantEvaluationForJobOwnerAsync(
    jobOwnerPublicId: string,
    jobPublicId: string,
    evaluationPublicId: string,
  ): Promise<Result<ApplicantEvaluationForJobOwnerDto, AppError>> {
    const isOwner = await this.jobRepository.authorizeJobOwner(
      jobOwnerPublicId,
      jobPublicId,
    );
    if (isOwner.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to authorize job owner',
          { cause: isOwner.error },
        ),
      );
    }
    if (isOwner.value === null) {
      return err(
        new AppError(
          ErrorCode.Forbidden,
          'Job owner is not authorized to view this evaluation',
        ),
      );
    }
    const cacheKey = this.buildJobOwnerCacheKey(
      jobOwnerPublicId,
      jobPublicId,
      evaluationPublicId,
    );
    try {
      const cached =
        await this.cacheManager.get<ApplicantEvaluationForJobOwnerDto>(
          cacheKey,
        );
      if (cached !== undefined) {
        return ok(cached);
      }
    } catch {
      this.logger.warn('Failed to read cached job owner evaluation');
    }
    const result =
      await this.applicantEvaluationRepository.getApplicantEvaluationForJobOwner(
        evaluationPublicId,
        jobPublicId,
      );
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get applicant evaluation for job owner',
          { cause: result.error },
        ),
      );
    }
    if (!result.value) {
      return err(
        new AppError(ErrorCode.NotFound, 'Applicant evaluation not found'),
      );
    }
    if (
      result.value.overallScore === null ||
      result.value.scoreBreakdown === null ||
      result.value.evidence === null
    ) {
      return err(
        new AppError(
          ErrorCode.Conflict,
          'Applicant evaluation is not completed',
        ),
      );
    }
    const detail: ApplicantEvaluationForJobOwnerDto = {
      ...(result.value.source ? { source: result.value.source } : {}),
      publicId: result.value.publicId,
      overallScore: result.value.overallScore,
      scoreBreakdown: result.value.scoreBreakdown,
      evidence: result.value.evidence,
      decisionSupportOnly: true,
      resumeRedaction: result.value.resumeRedaction,
      metadata: result.value.metadata,
    };
    try {
      await this.cacheManager.set(cacheKey, detail);
    } catch {
      this.logger.warn('Failed to cache job owner evaluation');
    }
    return ok(detail);
  }
  async getApplicantEvaluationDetailAsync(
    applicantPublicId: string,
    jobPublicId: string,
    evaluationPublicId?: string,
  ): Promise<Result<ApplicantEvaluationDetailDto, AppError>> {
    const result =
      await this.applicantEvaluationRepository.getApplicantEvaluationDetail(
        applicantPublicId,
        jobPublicId,
        ...(evaluationPublicId ? [evaluationPublicId] : []),
      );
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get applicant evaluation detail',
          { cause: result.error },
        ),
      );
    }
    if (!result.value) {
      return err(
        new AppError(ErrorCode.NotFound, 'Applicant evaluation not found'),
      );
    }
    if (
      result.value.overallScore === null ||
      result.value.scoreBreakdown === null ||
      result.value.evidence === null
    ) {
      return err(
        new AppError(
          ErrorCode.Conflict,
          'Applicant evaluation is not completed',
        ),
      );
    }
    return ok({
      ...(result.value.source ? { source: result.value.source } : {}),
      publicId: result.value.evaluationPublicId,
      overallScore: result.value.overallScore,
      scoreBreakdown: result.value.scoreBreakdown,
      evidence: result.value.evidence,
    });
  }

  async evaluateApplicantAsync(
    applicantPublicId: string,
    data: CreateApplicantEvaluationRequestDto,
  ): Promise<Result<ApplicantEvaluationResponseDto, AppError>> {
    let principal:
      | import('src/shared/common/jwt.payload.interface').JwtPayload
      | null
      | undefined;
    try {
      principal = await this.demoRepo?.principal(applicantPublicId);
      if (principal) {
        await this.demoRepo!.authorizeResources(principal, {
          jobPublicId: data.jobPublicId,
          resumePublicId: data.resumePublicId,
        });
        if (!this.configService.get<string>('LLM_EVALUATION_KEY')?.trim())
          return err(
            new AppError(
              ErrorCode.ServiceUnavailable,
              'Live AI is not configured. Sample results remain available.',
            ),
          );
      }
    } catch (error) {
      return err(
        error instanceof AppError
          ? error
          : new AppError(
              ErrorCode.InternalServerError,
              'Failed to authorize demo evaluation',
            ),
      );
    }
    const [jobResult, resumeResult] = await Promise.all([
      this.jobRepository.getJobDataForSnapshot(data.jobPublicId),
      this.resumeContentRepository.getCurrentForOwner(
        data.resumePublicId,
        applicantPublicId,
      ),
    ]);
    if (jobResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to evaluate applicant`,
          { cause: jobResult.error },
        ),
      );
    }
    if (resumeResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to evaluate applicant`,
          { cause: resumeResult.error },
        ),
      );
    }
    if (!jobResult.value) {
      return err(new AppError(ErrorCode.NotFound, `Job not found`));
    }

    if (!resumeResult.value) {
      return err(
        new AppError(ErrorCode.BadRequest, `User credentials not valid`),
      );
    }
    if (
      resumeResult.value.status !== CommonResumeIngestionStatus.COMPLETED ||
      !resumeResult.value.extractedText ||
      !resumeResult.value.contentHash
    ) {
      return err(
        new AppError(
          ErrorCode.BadRequest,
          'Resume ingestion must be completed before evaluation',
        ),
      );
    }
    const redactionResult = await this.resumeRedaction.redactResumeAsync(
      resumeResult.value.publicId,
    );
    if (redactionResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to redact resume', {
          cause: redactionResult.error,
        }),
      );
    }

    if (!redactionResult.value) {
      return err(new AppError(ErrorCode.BadRequest, 'Can not redact resume'));
    }
    if (
      principal &&
      redactionResult.value.text.length >
        this.demoAccess!.limits.maxResumeCharacters
    )
      return err(
        new AppError(
          ErrorCode.BadRequest,
          'Demo CV exceeds the redacted character limit',
        ),
      );

    const model = this.configService
      .get<string>('LLM_EVALUATION_MODEL')
      ?.trim();
    if (!model) {
      if (principal)
        return err(
          new AppError(
            ErrorCode.ServiceUnavailable,
            'Live AI is not configured. Sample results remain available.',
          ),
        );
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'LLM evaluation model is not configured',
        ),
      );
    }

    const jobSnapshot = jobResult.value.snapshot.skills.length
      ? buildJobSnapshotV2(jobResult.value.snapshot)
      : jobResult.value.snapshot;
    const jobContentHash = hashCanonicalJson(jobSnapshot);
    const prepareResult = await this.applicantEvaluationRepository.prepare({
      ...(principal
        ? {
            demoSessionId: principal.demoSessionId,
            demoLimits: this.demoAccess!.limits,
          }
        : {}),
      applicantPublicId,
      jobId: jobResult.value.jobId,
      resumeId: resumeResult.value.resumeId,
      resumeContentId: resumeResult.value.id,
      jobSnapshot,
      jobContentHash,
      resumeContentHash: resumeResult.value.contentHash,
      parserVersion: resumeResult.value.parserVersion,
      model,
      promptVersion:
        jobSnapshot.schemaVersion === 2
          ? APPLICANT_EVALUATION_PROMPT_VERSION_V2
          : APPLICANT_EVALUATION_PROMPT_VERSION,
      redactedResumeHash: redactionResult.value.hash,
      redactedResumeText: redactionResult.value.text,
      redactionVersion: redactionResult.value.redactionVersion,
    });
    if (prepareResult.isErr()) {
      if (
        principal &&
        prepareResult.error instanceof AppError &&
        prepareResult.error.code === ErrorCode.TooManyRequests
      )
        demoMetrics.ai('limited');
      if (prepareResult.error instanceof AppError)
        return err(prepareResult.error);
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to prepare applicant evaluation',
          { cause: prepareResult.error },
        ),
      );
    }
    if (!prepareResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Job application not found'));
    }
    if (prepareResult.value.charged) demoMetrics.ai('accepted');
    if (
      prepareResult.value.status === CommonEvaluationStatus.COMPLETED ||
      prepareResult.value.status === CommonEvaluationStatus.PROCESSING
    ) {
      return ok({ publicId: prepareResult.value.publicId });
    }

    const queuePayload = {
      ...(principal ? { demo: true } : {}),
      evaluationPublicId: prepareResult.value.publicId,
    };
    try {
      if (prepareResult.value.resetFromFailed) {
        await this.applicantEvaluationQueue.retry(queuePayload);
      } else {
        await this.applicantEvaluationQueue.enqueue(queuePayload);
      }
    } catch (error) {
      if (principal)
        await this.applicantEvaluationRepository.markFailed(
          prepareResult.value.publicId,
          'Live AI queue unavailable. Sample results remain available.',
        );
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to enqueue applicant evaluation',
          { cause: error },
        ),
      );
    }
    return ok({ publicId: prepareResult.value.publicId });
  }

  private buildJobOwnerCacheKey(
    jobOwnerPublicId: string,
    jobPublicId: string,
    evaluationPublicId: string,
  ): string {
    return `job-owner:${jobOwnerPublicId}:${jobPublicId}:${evaluationPublicId}`;
  }
}
