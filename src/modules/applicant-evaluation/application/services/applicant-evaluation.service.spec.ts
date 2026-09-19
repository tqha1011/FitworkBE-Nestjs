import { ConfigService } from '@nestjs/config';
import { err, ok } from 'neverthrow';
import { IJobRepository } from 'src/modules/job/domain/repositories/job.repo.interface';
import { IResumeContentRepository } from 'src/modules/resume/domain/repositories/resume-content.repo.interface';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { ErrorCode } from 'src/shared/common/errorCode';
import {
  CommonEvaluationStatus,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import { APPLICANT_EVALUATION_PROMPT_VERSION } from '../constants/applicant-evaluation.constants';
import { ApplicantEvaluationService } from './applicant-evaluation.service';

describe('ApplicantEvaluationService', () => {
  const request = {
    jobPublicId: 'job-id',
    resumePublicId: 'resume-id',
  };
  const jobSnapshot = {
    schemaVersion: 1 as const,
    publicId: 'job-id',
    title: 'Backend Engineer',
    description: 'Build services',
    requirements: 'TypeScript',
    location: 'Remote',
    skills: [{ id: 1, name: 'TypeScript' }],
    category: { id: 2, name: 'Engineering' },
    arrangement: { id: 3, name: 'Remote' },
  };
  const resumeContent = {
    id: 30,
    resumeId: 20,
    status: CommonResumeIngestionStatus.COMPLETED,
    extractedText: 'Experienced TypeScript engineer',
    contentHash: 'resume-hash',
    parserVersion: 'parser-v1',
  };

  let resumeContentRepository: { getCurrentForOwner: jest.Mock };
  let jobRepository: { getJobDataForSnapshot: jest.Mock };
  let applicantEvaluationRepository: {
    prepare: jest.Mock;
    claimForProcessing: jest.Mock;
    markCompleted: jest.Mock;
    markPending: jest.Mock;
    markFailed: jest.Mock;
  };
  let applicantEvaluationQueue: { enqueue: jest.Mock; retry: jest.Mock };
  let configService: { get: jest.Mock };
  let service: ApplicantEvaluationService;

  beforeEach(() => {
    resumeContentRepository = {
      getCurrentForOwner: jest.fn().mockResolvedValue(ok(resumeContent)),
    };
    jobRepository = {
      getJobDataForSnapshot: jest.fn().mockResolvedValue(
        ok({
          jobId: 10,
          snapshot: jobSnapshot,
        }),
      ),
    };
    applicantEvaluationRepository = {
      prepare: jest.fn().mockResolvedValue(
        ok({
          publicId: 'evaluation-id',
          status: CommonEvaluationStatus.PENDING,
          resetFromFailed: false,
        }),
      ),
      claimForProcessing: jest.fn(),
      markCompleted: jest.fn(),
      markPending: jest.fn(),
      markFailed: jest.fn(),
    };
    applicantEvaluationQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn().mockReturnValue('evaluation-model'),
    };
    service = new ApplicantEvaluationService(
      resumeContentRepository as unknown as IResumeContentRepository,
      jobRepository as unknown as IJobRepository,
      applicantEvaluationRepository,
      applicantEvaluationQueue,
      configService as unknown as ConfigService,
    );
  });

  it('persists evaluation inputs before enqueueing an ID-only job', async () => {
    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result.isOk()).toBe(true);
    expect(resumeContentRepository.getCurrentForOwner).toHaveBeenCalledWith(
      request.resumePublicId,
      'applicant-id',
    );
    expect(applicantEvaluationRepository.prepare).toHaveBeenCalledWith({
      applicantPublicId: 'applicant-id',
      jobId: 10,
      resumeId: resumeContent.resumeId,
      resumeContentId: resumeContent.id,
      jobSnapshot,
      jobContentHash: hashCanonicalJson(jobSnapshot),
      resumeContentHash: resumeContent.contentHash,
      parserVersion: resumeContent.parserVersion,
      model: 'evaluation-model',
      promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION,
    });
    expect(applicantEvaluationQueue.enqueue).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
    });
    expect(applicantEvaluationQueue.retry).not.toHaveBeenCalled();
  });

  it('retries the same BullMQ job after resetting a failed evaluation', async () => {
    applicantEvaluationRepository.prepare.mockResolvedValue(
      ok({
        publicId: 'evaluation-id',
        status: CommonEvaluationStatus.PENDING,
        resetFromFailed: true,
      }),
    );

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result.isOk()).toBe(true);
    expect(applicantEvaluationQueue.retry).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
    });
    expect(applicantEvaluationQueue.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    CommonEvaluationStatus.PROCESSING,
    CommonEvaluationStatus.COMPLETED,
  ])('does not enqueue an evaluation in %s state', async (status) => {
    applicantEvaluationRepository.prepare.mockResolvedValue(
      ok({ publicId: 'evaluation-id', status, resetFromFailed: false }),
    );

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result.isOk()).toBe(true);
    expect(applicantEvaluationQueue.enqueue).not.toHaveBeenCalled();
    expect(applicantEvaluationQueue.retry).not.toHaveBeenCalled();
  });

  it('rejects a resume that has not completed ingestion', async () => {
    resumeContentRepository.getCurrentForOwner.mockResolvedValue(
      ok({
        ...resumeContent,
        status: CommonResumeIngestionStatus.PROCESSING,
        extractedText: null,
        contentHash: null,
      }),
    );

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.BadRequest);
    expect(applicantEvaluationRepository.prepare).not.toHaveBeenCalled();
  });

  it('returns not found when the matching job application does not exist', async () => {
    applicantEvaluationRepository.prepare.mockResolvedValue(ok(null));

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    expect(applicantEvaluationQueue.enqueue).not.toHaveBeenCalled();
  });

  it('returns an internal error when persistence fails', async () => {
    applicantEvaluationRepository.prepare.mockResolvedValue(
      err(new Error('database down')),
    );

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
    expect(applicantEvaluationQueue.enqueue).not.toHaveBeenCalled();
  });

  it('returns an internal error when enqueueing fails', async () => {
    applicantEvaluationQueue.enqueue.mockRejectedValue(new Error('Redis down'));

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
  });
});
