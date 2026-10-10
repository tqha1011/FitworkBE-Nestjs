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
import {
  APPLICANT_EVALUATION_PROMPT_VERSION,
  APPLICANT_EVALUATION_PROMPT_VERSION_V2,
} from '../constants/applicant-evaluation.constants';
import { ApplicantEvaluationService } from './applicant-evaluation.service';
import { buildJobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { createResumeEvaluationSnapshot } from './resume-redact-evaluation';

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
    publicId: 'resume-content-id',
    resumeId: 20,
    status: CommonResumeIngestionStatus.COMPLETED,
    extractedText: 'Experienced TypeScript engineer',
    contentHash: 'resume-hash',
    parserVersion: 'parser-v1',
  };

  let resumeContentRepository: { getCurrentForOwner: jest.Mock };
  let jobRepository: {
    getJobDataForSnapshot: jest.Mock;
    authorizeJobOwner: jest.Mock;
  };
  let applicantEvaluationRepository: {
    prepare: jest.Mock;
    claimForProcessing: jest.Mock;
    markCompleted: jest.Mock;
    markPending: jest.Mock;
    markFailed: jest.Mock;
    getRealtimeStateForApplicant: jest.Mock;
    getApplicantEvaluationDetail: jest.Mock;
    getApplicantEvaluationForJobOwner: jest.Mock;
  };
  let applicantEvaluationQueue: { enqueue: jest.Mock; retry: jest.Mock };
  let applicationCache: {
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let service: ApplicantEvaluationService;
  let resumeRedaction: { redactResumeAsync: jest.Mock };

  beforeEach(() => {
    resumeContentRepository = {
      getCurrentForOwner: jest.fn().mockResolvedValue(ok(resumeContent)),
    };
    jobRepository = {
      authorizeJobOwner: jest.fn().mockResolvedValue(ok(undefined)),
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
      getRealtimeStateForApplicant: jest.fn(),
      getApplicantEvaluationDetail: jest.fn(),
      getApplicantEvaluationForJobOwner: jest.fn(),
    };
    applicantEvaluationQueue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    applicationCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn().mockReturnValue('evaluation-model'),
    };
    resumeRedaction = {
      redactResumeAsync: jest
        .fn()
        .mockResolvedValue(
          ok(createResumeEvaluationSnapshot(resumeContent.extractedText)),
        ),
    };
    service = new ApplicantEvaluationService(
      resumeContentRepository as unknown as IResumeContentRepository,
      jobRepository as unknown as IJobRepository,
      applicantEvaluationRepository,
      applicantEvaluationQueue,
      configService as unknown as ConfigService,
      applicationCache,
      resumeRedaction,
    );
  });

  describe('getApplicantEvaluationForJobOwnerAsync', () => {
    const ownerDetail = {
      publicId: 'evaluation-id',
      overallScore: 42,
      scoreBreakdown: {
        schemaVersion: 2 as const,
        criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
      },
      evidence: {
        schemaVersion: 2 as const,
        criteria: [
          {
            criterionId: 'skill:1',
            criterionText: 'TypeScript',
            verdict: 'PARTIAL' as const,
            scoreContribution: 42,
            explanation: 'Skill is mentioned.',
            evidence: [
              {
                snippet: 'TypeScript',
                section: 'resume' as const,
                startOffset: 0,
                endOffset: 10,
              },
            ],
          },
        ],
        strengths: ['TypeScript'],
        gaps: [],
        explanation: 'Relevant skill found.',
      },
      decisionSupportOnly: true as const,
      resumeRedaction: {
        redactedResumeText: 'TypeScript',
        redactedResumeVersion: 'resume-redaction-v1',
      },
      metadata: {
        jobContentHash: 'job-hash',
        resumeContentHash: 'resume-hash',
        redactedResumeHash: 'redacted-hash',
        parserVersion: 'parser-v1',
        redactionVersion: 'resume-redaction-v1',
        model: 'gemini-model',
        promptVersion: 'applicant-match-v2',
      },
    };

    it('returns V2 detail only after checking job ownership and job binding', async () => {
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok(ownerDetail),
      );

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap()).toEqual(ownerDetail);
      expect(jobRepository.authorizeJobOwner).toHaveBeenCalledWith(
        'owner-id',
        'job-id',
      );
      expect(
        applicantEvaluationRepository.getApplicantEvaluationForJobOwner,
      ).toHaveBeenCalledWith('evaluation-id', 'job-id');
      expect(applicationCache.get).toHaveBeenCalledWith(
        'job-owner:owner-id:job-id:evaluation-id',
      );
      expect(applicationCache.set).toHaveBeenCalledWith(
        'job-owner:owner-id:job-id:evaluation-id',
        ownerDetail,
      );
    });

    it('uses cached owner detail only after checking job ownership', async () => {
      applicationCache.get.mockResolvedValue(ownerDetail);

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap()).toEqual(ownerDetail);
      expect(jobRepository.authorizeJobOwner).toHaveBeenCalledWith(
        'owner-id',
        'job-id',
      );
      expect(applicationCache.get).toHaveBeenCalledWith(
        'job-owner:owner-id:job-id:evaluation-id',
      );
      expect(
        applicantEvaluationRepository.getApplicantEvaluationForJobOwner,
      ).not.toHaveBeenCalled();
    });

    it('denies a user who does not own the job', async () => {
      jobRepository.authorizeJobOwner.mockResolvedValue(ok(null));
      applicationCache.get.mockResolvedValue(ownerDetail);

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'other-user',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.Forbidden);
      expect(applicationCache.get).not.toHaveBeenCalled();
      expect(
        applicantEvaluationRepository.getApplicantEvaluationForJobOwner,
      ).not.toHaveBeenCalled();
    });

    it('keeps owner cache entries separate by job', async () => {
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok(ownerDetail),
      );

      await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'another-job-id',
        'evaluation-id',
      );

      expect(applicationCache.get).toHaveBeenCalledWith(
        'job-owner:owner-id:another-job-id:evaluation-id',
      );
      expect(
        applicantEvaluationRepository.getApplicantEvaluationForJobOwner,
      ).toHaveBeenCalledWith('evaluation-id', 'another-job-id');
    });

    it('falls back to the repository when the owner cache fails', async () => {
      applicationCache.get.mockRejectedValue(new Error('Redis unavailable'));
      applicationCache.set.mockRejectedValue(new Error('Redis unavailable'));
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok(ownerDetail),
      );

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap()).toEqual(ownerDetail);
      expect(
        applicantEvaluationRepository.getApplicantEvaluationForJobOwner,
      ).toHaveBeenCalledWith('evaluation-id', 'job-id');
    });

    it('hides evaluations belonging to another job', async () => {
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok(null),
      );

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'other-job-evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    });

    it('does not expose a pending evaluation as a result', async () => {
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok({ ...ownerDetail, overallScore: null }),
      );

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.Conflict);
    });

    it('allows a completed V1 result without redaction fields', async () => {
      const v1Detail = {
        ...ownerDetail,
        overallScore: 88,
        scoreBreakdown: {
          schemaVersion: 1 as const,
          skills: 90,
          experience: 85,
          education: 75,
          overallFit: 88,
        },
        evidence: {
          schemaVersion: 1 as const,
          strengths: ['TypeScript'],
          gaps: [],
          explanation: 'Relevant skill found.',
        },
        resumeRedaction: {
          redactedResumeText: null,
          redactedResumeVersion: null,
        },
      };
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        ok(v1Detail),
      );

      const result = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap()).toEqual(v1Detail);
    });

    it('returns a safe error when ownership or evaluation lookup fails', async () => {
      jobRepository.authorizeJobOwner.mockResolvedValue(
        err(new Error('database credentials leaked')),
      );

      const ownerError = await service.getApplicantEvaluationForJobOwnerAsync(
        'owner-id',
        'job-id',
        'evaluation-id',
      );
      expect(ownerError._unsafeUnwrapErr().code).toBe(
        ErrorCode.InternalServerError,
      );
      expect(ownerError._unsafeUnwrapErr().message).not.toContain(
        'credentials',
      );

      jobRepository.authorizeJobOwner.mockResolvedValue(ok(undefined));
      applicantEvaluationRepository.getApplicantEvaluationForJobOwner.mockResolvedValue(
        err(new Error('database credentials leaked')),
      );
      const evaluationError =
        await service.getApplicantEvaluationForJobOwnerAsync(
          'owner-id',
          'job-id',
          'evaluation-id',
        );
      expect(evaluationError._unsafeUnwrapErr().code).toBe(
        ErrorCode.InternalServerError,
      );
      expect(evaluationError._unsafeUnwrapErr().message).not.toContain(
        'credentials',
      );
    });
  });

  describe('getApplicantEvaluationDetailAsync', () => {
    const detail = {
      evaluationPublicId: 'evaluation-id',
      overallScore: 88,
      scoreBreakdown: {
        schemaVersion: 1 as const,
        skills: 90,
        experience: 85,
        education: 75,
        overallFit: 88,
      },
      evidence: {
        schemaVersion: 1 as const,
        strengths: ['Strong TypeScript experience'],
        gaps: ['No PostgreSQL evidence'],
        explanation: 'Candidate matches most requirements.',
      },
    };

    it('returns completed evaluation detail', async () => {
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        ok(detail),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(
        applicantEvaluationRepository.getApplicantEvaluationDetail,
      ).toHaveBeenCalledWith('applicant-id', 'evaluation-id');
      expect(result._unsafeUnwrap()).toEqual({
        publicId: 'evaluation-id',
        overallScore: 88,
        scoreBreakdown: detail.scoreBreakdown,
        evidence: detail.evidence,
      });
      expect(applicationCache.set).toHaveBeenCalledWith(
        'applicant:applicant-id:evaluation-id',
        {
          publicId: 'evaluation-id',
          overallScore: 88,
          scoreBreakdown: detail.scoreBreakdown,
          evidence: detail.evidence,
        },
      );
    });

    it('returns cached detail without querying the repository', async () => {
      const cachedDetail = {
        publicId: 'evaluation-id',
        overallScore: 88,
        scoreBreakdown: detail.scoreBreakdown,
        evidence: detail.evidence,
      };
      applicationCache.get.mockResolvedValue(cachedDetail);

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap()).toEqual(cachedDetail);
      expect(
        applicantEvaluationRepository.getApplicantEvaluationDetail,
      ).not.toHaveBeenCalled();
      expect(applicationCache.set).not.toHaveBeenCalled();
    });

    it('falls back to the repository when reading cache fails', async () => {
      applicationCache.get.mockRejectedValue(new Error('Redis unavailable'));
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        ok(detail),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap().publicId).toBe('evaluation-id');
      expect(
        applicantEvaluationRepository.getApplicantEvaluationDetail,
      ).toHaveBeenCalled();
    });

    it('returns repository detail when writing cache fails', async () => {
      applicationCache.set.mockRejectedValue(new Error('Redis unavailable'));
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        ok(detail),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrap().publicId).toBe('evaluation-id');
    });

    it('returns not found when evaluation does not exist', async () => {
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        ok(null),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    });

    it('returns conflict when evaluation is not completed', async () => {
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        ok({ ...detail, overallScore: null }),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.Conflict);
    });

    it('returns internal error when repository fails', async () => {
      applicantEvaluationRepository.getApplicantEvaluationDetail.mockResolvedValue(
        err(new Error('database down')),
      );

      const result = await service.getApplicantEvaluationDetailAsync(
        'applicant-id',
        'evaluation-id',
      );

      expect(result._unsafeUnwrapErr().code).toBe(
        ErrorCode.InternalServerError,
      );
    });
  });

  it('persists evaluation inputs before enqueueing an ID-only job', async () => {
    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ publicId: 'evaluation-id' });
    expect(resumeContentRepository.getCurrentForOwner).toHaveBeenCalledWith(
      request.resumePublicId,
      'applicant-id',
    );
    expect(resumeRedaction.redactResumeAsync).toHaveBeenCalledWith(
      resumeContent.publicId,
    );
    const jobSnapshotV2 = buildJobSnapshotV2(jobSnapshot);
    expect(applicantEvaluationRepository.prepare).toHaveBeenCalledWith({
      applicantPublicId: 'applicant-id',
      jobId: 10,
      resumeId: resumeContent.resumeId,
      resumeContentId: resumeContent.id,
      jobSnapshot: jobSnapshotV2,
      jobContentHash: hashCanonicalJson(jobSnapshotV2),
      resumeContentHash: resumeContent.contentHash,
      parserVersion: resumeContent.parserVersion,
      model: 'evaluation-model',
      promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION_V2,
      redactedResumeText: resumeContent.extractedText,
      redactedResumeHash: createResumeEvaluationSnapshot(
        resumeContent.extractedText,
      ).hash,
      redactionVersion: 'resume-redaction-v1',
    });
    expect(applicantEvaluationQueue.enqueue).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
    });
    expect(applicantEvaluationQueue.retry).not.toHaveBeenCalled();
  });

  it('keeps V1 evaluation for a job without structured skills', async () => {
    const noSkillsSnapshot = { ...jobSnapshot, skills: [] };
    jobRepository.getJobDataForSnapshot.mockResolvedValue(
      ok({ jobId: 10, snapshot: noSkillsSnapshot }),
    );

    const result = await service.evaluateApplicantAsync(
      'applicant-id',
      request,
    );

    expect(result.isOk()).toBe(true);
    expect(applicantEvaluationRepository.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        jobSnapshot: noSkillsSnapshot,
        jobContentHash: hashCanonicalJson(noSkillsSnapshot),
        promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION,
      }),
    );
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
    expect(result._unsafeUnwrap()).toEqual({ publicId: 'evaluation-id' });
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
    expect(result._unsafeUnwrap()).toEqual({ publicId: 'evaluation-id' });
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

  it.each(['job', 'resume', 'redaction', 'prepare', 'enqueue'])(
    'keeps the %s failure private with its cause',
    async (stage) => {
      const failure = new Error('private dependency payload');
      const dependencies: Record<string, jest.Mock> = {
        job: jobRepository.getJobDataForSnapshot,
        resume: resumeContentRepository.getCurrentForOwner,
        redaction: resumeRedaction.redactResumeAsync,
        prepare: applicantEvaluationRepository.prepare,
      };
      if (stage === 'enqueue')
        applicantEvaluationQueue.enqueue.mockRejectedValue(failure);
      else dependencies[stage].mockResolvedValue(err(failure));
      const error = (
        await service.evaluateApplicantAsync('applicant', request)
      )._unsafeUnwrapErr();
      expect(error.cause).toBe(failure);
      expect(error.code).toBe(ErrorCode.InternalServerError);
      expect(error.message).not.toContain('private dependency payload');
    },
  );
});
