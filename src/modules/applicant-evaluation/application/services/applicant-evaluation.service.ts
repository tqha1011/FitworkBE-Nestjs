import { Injectable } from '@nestjs/common';
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
  ) {}
  async getApplicantEvaluationDetailAsync(
    applicantPublicId: string,
    evaluationPublicId: string,
  ): Promise<Result<ApplicantEvaluationDetailDto, AppError>> {
    try {
      const cacheResult =
        await this.cacheManager.get<ApplicantEvaluationDetailDto>(
          this.buildCacheKey(applicantPublicId, evaluationPublicId),
        );
      if (cacheResult !== undefined) {
        return ok(cacheResult);
      }
    } catch (error) {
      this.logger.error(
        `Failed to get cached result at ${ApplicantEvaluationService.name}: ${error}`,
      );
    }
    const result =
      await this.applicantEvaluationRepository.getApplicantEvaluationDetail(
        applicantPublicId,
        evaluationPublicId,
      );
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get applicant evaluation detail',
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
    try {
      await this.cacheManager.set(
        this.buildCacheKey(applicantPublicId, result.value.evaluationPublicId),
        {
          publicId: result.value.evaluationPublicId,
          overallScore: result.value.overallScore,
          scoreBreakdown: result.value.scoreBreakdown,
          evidence: result.value.evidence,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to cache evaluation ${error}`);
    }

    return ok({
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
    const [jobResult, resumeResult] = await Promise.all([
      this.jobRepository.getJobDataForSnapshot(data.jobPublicId),
      this.resumeContentRepository.getCurrentForOwner(
        data.resumePublicId,
        applicantPublicId,
      ),
    ]);
    if (jobResult.isErr() || resumeResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to evaluate applicant`,
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
        new AppError(ErrorCode.InternalServerError, 'Failed to redact resume'),
      );
    }

    if (!redactionResult.value) {
      return err(new AppError(ErrorCode.BadRequest, 'Can not redact resume'));
    }

    const model = this.configService
      .get<string>('LLM_EVALUATION_MODEL')
      ?.trim();
    if (!model) {
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
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to prepare applicant evaluation',
        ),
      );
    }
    if (!prepareResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Job application not found'));
    }
    if (
      prepareResult.value.status === CommonEvaluationStatus.COMPLETED ||
      prepareResult.value.status === CommonEvaluationStatus.PROCESSING
    ) {
      return ok({ publicId: prepareResult.value.publicId });
    }

    const queuePayload = {
      evaluationPublicId: prepareResult.value.publicId,
    };
    try {
      if (prepareResult.value.resetFromFailed) {
        await this.applicantEvaluationQueue.retry(queuePayload);
      } else {
        await this.applicantEvaluationQueue.enqueue(queuePayload);
      }
    } catch (error) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to enqueue applicant evaluation: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    return ok({ publicId: prepareResult.value.publicId });
  }

  private buildCacheKey(
    applicantPublicId: string,
    evaluationPublicId: string,
  ): string {
    return `applicant:${applicantPublicId}:${evaluationPublicId}`;
  }
}
