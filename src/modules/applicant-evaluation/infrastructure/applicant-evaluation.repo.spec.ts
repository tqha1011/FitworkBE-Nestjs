import { EvaluationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { JobSnapshotV1 } from 'src/modules/job/domain/value-objects/job-snapshot';
import {
  CompleteApplicantEvaluationInput,
  PrepareApplicantEvaluationInput,
} from '../domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationRepository } from './applicant-evaluation.repo';
import { createResumeEvaluationSnapshot } from '../application/services/resume-redact-evaluation';

jest.mock('generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { DbNull: 'DbNull' },
}));

describe('ApplicantEvaluationRepository', () => {
  const jobSnapshot: JobSnapshotV1 = {
    schemaVersion: 1,
    publicId: 'job-id',
    title: 'Backend Engineer',
    description: 'Build services',
    requirements: 'TypeScript',
    location: 'Remote',
    skills: [{ id: 1, name: 'TypeScript' }],
    category: { id: 2, name: 'Engineering' },
    arrangement: { id: 3, name: 'Remote' },
  };
  const input: PrepareApplicantEvaluationInput = {
    applicantPublicId: 'applicant-id',
    jobId: 10,
    resumeId: 20,
    resumeContentId: 30,
    jobSnapshot,
    jobContentHash: hashCanonicalJson(jobSnapshot),
    resumeContentHash: 'resume-hash',
    parserVersion: 'parser-v1',
    model: 'evaluation-model',
    promptVersion: 'applicant-match-v1',
    redactedResumeText:
      'Five years of TypeScript experience. [REDACTED CONTACT]',
    redactedResumeHash: createResumeEvaluationSnapshot(
      'Five years of TypeScript experience. [REDACTED CONTACT]',
    ).hash,
    redactionVersion: 'resume-redaction-v1',
  };
  const createProcessingEvaluation = () => ({
    publicId: 'evaluation-id',
    status: EvaluationStatus.PENDING,
    resumeContentHash: input.resumeContentHash,
    jobContentHash: input.jobContentHash,
    parserVersion: input.parserVersion,
    model: input.model,
    promptVersion: input.promptVersion,
    jobSnapshot,
    resumeContent: {
      extractedText: 'Five years of TypeScript experience. jane@example.com',
      contentHash: input.resumeContentHash,
      parserVersion: input.parserVersion,
    },
    redactedResumeText: input.redactedResumeText,
    redactedResumeHash: input.redactedResumeHash,
    redactionVersion: input.redactionVersion,
    jobApplicant: {
      jobSnapshot,
      resumeContent: {
        extractedText: 'Five years of TypeScript experience. jane@example.com',
        contentHash: input.resumeContentHash,
        parserVersion: input.parserVersion,
      },
    },
  });

  let tx: {
    jobApplicant: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    applicantEvaluation: {
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let prismaService: {
    $transaction: jest.Mock;
    applicantEvaluation: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let repository: ApplicantEvaluationRepository;

  beforeEach(() => {
    tx = {
      jobApplicant: {
        findFirst: jest.fn().mockResolvedValue({ id: 40 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      applicantEvaluation: {
        upsert: jest.fn().mockResolvedValue({
          publicId: 'evaluation-id',
          status: EvaluationStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(createProcessingEvaluation()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const runTransaction = async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ): Promise<unknown> => callback(tx);
    prismaService = {
      $transaction: jest.fn(runTransaction),
      applicantEvaluation: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    repository = new ApplicantEvaluationRepository(
      prismaService as unknown as PrismaService,
    );
  });

  describe('getApplicantEvaluationForJobOwner', () => {
    it('filters by evaluation and job and returns V2 result metadata', async () => {
      const scoreBreakdown = {
        schemaVersion: 2,
        criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
      };
      const evidence = {
        schemaVersion: 2,
        strengths: ['TypeScript'],
        gaps: [],
        explanation: 'Relevant skill found.',
        criteria: [
          {
            criterionId: 'skill:1',
            criterionText: 'TypeScript',
            verdict: 'PARTIAL',
            scoreContribution: 42,
            explanation: 'Skill is mentioned.',
            evidence: [
              {
                snippet: 'TypeScript',
                section: 'resume',
                startOffset: 0,
                endOffset: 10,
              },
            ],
          },
        ],
      };
      prismaService.applicantEvaluation.findUnique.mockResolvedValue({
        publicId: 'evaluation-id',
        overallScore: 42,
        scoreBreakdown,
        evidence,
        redactedResumeText: 'TypeScript',
        redactedResumeHash: 'redacted-hash',
        redactionVersion: 'resume-redaction-v1',
        jobContentHash: 'job-hash',
        resumeContentHash: 'resume-hash',
        parserVersion: 'parser-v1',
        model: 'gemini-model',
        promptVersion: 'applicant-match-v2',
      });

      const result = await repository.getApplicantEvaluationForJobOwner(
        'evaluation-id',
        'job-id',
      );

      expect(prismaService.applicantEvaluation.findUnique).toHaveBeenCalledWith(
        {
          where: {
            publicId: 'evaluation-id',
            jobApplicant: { job: { publicId: 'job-id' } },
          },
          select: {
            publicId: true,
            overallScore: true,
            scoreBreakdown: true,
            evidence: true,
            redactedResumeText: true,
            redactedResumeHash: true,
            redactionVersion: true,
            jobContentHash: true,
            resumeContentHash: true,
            parserVersion: true,
            model: true,
            promptVersion: true,
          },
        },
      );
      expect(result._unsafeUnwrap()).toEqual({
        publicId: 'evaluation-id',
        overallScore: 42,
        scoreBreakdown,
        evidence,
        decisionSupportOnly: true,
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
      });
    });

    it('returns null when evaluation is absent or belongs to another job', async () => {
      prismaService.applicantEvaluation.findUnique.mockResolvedValue(null);

      const result = await repository.getApplicantEvaluationForJobOwner(
        'other-evaluation-id',
        'job-id',
      );

      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('getRealtimeStateForApplicant', () => {
    it('returns the current state only for the owning applicant', async () => {
      const updatedAt = new Date('2026-09-19T00:00:00.000Z');
      prismaService.applicantEvaluation.findUnique.mockResolvedValue({
        publicId: 'evaluation-id',
        status: EvaluationStatus.COMPLETED,
        overallScore: 88,
        errorMessage: null,
        updatedAt,
      });

      const result = await repository.getRealtimeStateForApplicant(
        'evaluation-id',
        'applicant-id',
      );

      expect(prismaService.applicantEvaluation.findUnique).toHaveBeenCalledWith(
        {
          where: {
            publicId: 'evaluation-id',
            jobApplicant: {
              applicant: { publicId: 'applicant-id' },
            },
          },
          select: {
            publicId: true,
            status: true,
            overallScore: true,
            errorMessage: true,
            updatedAt: true,
          },
        },
      );
      expect(result._unsafeUnwrap()).toEqual({
        evaluationPublicId: 'evaluation-id',
        status: CommonEvaluationStatus.COMPLETED,
        overallScore: 88,
        errorMessage: null,
        updatedAt,
      });
    });

    it('returns null when the applicant does not own the evaluation', async () => {
      prismaService.applicantEvaluation.findUnique.mockResolvedValue(null);

      const result = await repository.getRealtimeStateForApplicant(
        'evaluation-id',
        'another-applicant',
      );

      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  it('attaches immutable inputs and creates or reuses an evaluation atomically', async () => {
    const result = await repository.prepare(input);

    expect(result._unsafeUnwrap()).toEqual({
      publicId: 'evaluation-id',
      status: CommonEvaluationStatus.PENDING,
      resetFromFailed: false,
    });
    expect(tx.jobApplicant.findFirst).toHaveBeenCalledWith({
      where: {
        jobId: input.jobId,
        resumeId: input.resumeId,
        applicant: { publicId: input.applicantPublicId },
      },
      select: { id: true },
    });
    expect(tx.jobApplicant.update).toHaveBeenCalledWith({
      where: { id: 40 },
      data: {
        resumeContentId: input.resumeContentId,
        jobSnapshot: input.jobSnapshot,
        jobContentHash: input.jobContentHash,
        updatedAt: expect.any(Date) as Date,
      },
    });
    expect(tx.applicantEvaluation.upsert).toHaveBeenCalledWith({
      where: {
        jobApplicantId_resumeContentHash_jobContentHash_parserVersion_model_promptVersion:
          {
            jobApplicantId: 40,
            resumeContentHash: input.resumeContentHash,
            jobContentHash: input.jobContentHash,
            parserVersion: input.parserVersion,
            model: input.model,
            promptVersion: input.promptVersion,
          },
      },
      update: {},
      create: {
        jobApplicantId: 40,
        resumeContentHash: input.resumeContentHash,
        jobContentHash: input.jobContentHash,
        parserVersion: input.parserVersion,
        model: input.model,
        promptVersion: input.promptVersion,
        jobSnapshot,
        resumeContentId: input.resumeContentId,
        redactedResumeText: input.redactedResumeText,
        redactedResumeHash: input.redactedResumeHash,
        redactionVersion: input.redactionVersion,
      },
      select: { publicId: true, status: true },
    });
  });

  it('resets a failed evaluation so its BullMQ job can be retried', async () => {
    tx.applicantEvaluation.upsert.mockResolvedValue({
      publicId: 'evaluation-id',
      status: EvaluationStatus.FAILED,
    });

    const result = await repository.prepare(input);

    expect(result._unsafeUnwrap()).toEqual({
      publicId: 'evaluation-id',
      status: CommonEvaluationStatus.PENDING,
      resetFromFailed: true,
    });
    expect(tx.applicantEvaluation.update).toHaveBeenCalledWith({
      where: { publicId: 'evaluation-id' },
      data: {
        status: EvaluationStatus.PENDING,
        errorMessage: null,
        overallScore: null,
        scoreBreakdown: Prisma.DbNull,
        evidence: Prisma.DbNull,
        evaluatedAt: null,
      },
    });
  });

  it('returns an existing completed evaluation without resetting it', async () => {
    tx.applicantEvaluation.upsert.mockResolvedValue({
      publicId: 'evaluation-id',
      status: EvaluationStatus.COMPLETED,
    });

    const result = await repository.prepare(input);

    expect(result._unsafeUnwrap()).toEqual({
      publicId: 'evaluation-id',
      status: CommonEvaluationStatus.COMPLETED,
      resetFromFailed: false,
    });
    expect(tx.applicantEvaluation.update).not.toHaveBeenCalled();
  });

  it('returns null when the user did not apply with that resume', async () => {
    tx.jobApplicant.findFirst.mockResolvedValue(null);

    const result = await repository.prepare(input);

    expect(result._unsafeUnwrap()).toBeNull();
    expect(tx.jobApplicant.update).not.toHaveBeenCalled();
    expect(tx.applicantEvaluation.upsert).not.toHaveBeenCalled();
  });

  it('returns an error when the transaction fails', async () => {
    prismaService.$transaction.mockRejectedValue(new Error('database down'));

    const result = await repository.prepare(input);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      'Failed to prepare applicant evaluation',
    );
  });

  describe('claimForProcessing', () => {
    it('returns an error when legacy evaluation input is unavailable', async () => {
      tx.applicantEvaluation.findUnique
        .mockResolvedValueOnce({
          ...createProcessingEvaluation(),
          jobSnapshot: null,
          resumeContent: null,
        })
        .mockResolvedValueOnce({
          jobApplicant: { jobSnapshot: null, resumeContent: null },
        });

      const result = await repository.claimForProcessing('evaluation-id');

      expect(result.isErr()).toBe(true);
      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation input is unavailable',
      );
      expect(tx.applicantEvaluation.updateMany).not.toHaveBeenCalled();
    });

    it('validates persisted inputs and claims an evaluation', async () => {
      const result = await repository.claimForProcessing('evaluation-id');

      expect(result._unsafeUnwrap()).toEqual({
        publicId: 'evaluation-id',
        jobSnapshot,
        resumeRedactedText: input.redactedResumeText,
        resumeRedactedHash: input.redactedResumeHash,
        resumeRedactionVersion: input.redactionVersion,
        model: input.model,
        promptVersion: input.promptVersion,
      });
      expect(result._unsafeUnwrap()?.resumeRedactedText).not.toContain(
        'jane@example.com',
      );
      expect(tx.applicantEvaluation.updateMany).toHaveBeenCalledWith({
        where: {
          publicId: 'evaluation-id',
          status: {
            in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
          },
        },
        data: {
          status: EvaluationStatus.PROCESSING,
          errorMessage: null,
        },
      });
    });

    it.each([EvaluationStatus.COMPLETED, EvaluationStatus.FAILED])(
      'does not claim an evaluation in %s state',
      async (status) => {
        tx.applicantEvaluation.findUnique.mockResolvedValue({
          ...createProcessingEvaluation(),
          status,
        });

        const result = await repository.claimForProcessing('evaluation-id');

        expect(result._unsafeUnwrap()).toBeNull();
        expect(tx.applicantEvaluation.updateMany).not.toHaveBeenCalled();
      },
    );

    it('returns null when the evaluation does not exist', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue(null);

      const result = await repository.claimForProcessing('missing-id');

      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns an error when resume content is incomplete', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        resumeContent: null,
      });

      const result = await repository.claimForProcessing('evaluation-id');

      expect(result.isErr()).toBe(true);
      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation resume content is incomplete',
      );
    });

    it('rejects a redacted snapshot whose hash does not match', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        redactedResumeHash: 'wrong-hash',
      });

      const result = await repository.claimForProcessing('evaluation-id');

      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation redacted resume hash does not match',
      );
      expect(tx.applicantEvaluation.updateMany).not.toHaveBeenCalled();
    });

    it('creates and persists a redacted snapshot for a legacy row', async () => {
      const rawText =
        'Jane Doe\nEmail: jane@example.com\nExperience\nBuilt NestJS APIs.';
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        resumeContent: {
          extractedText: rawText,
          contentHash: input.resumeContentHash,
          parserVersion: input.parserVersion,
        },
        redactedResumeText: null,
        redactedResumeHash: null,
        redactionVersion: null,
      });

      const result = await repository.claimForProcessing('evaluation-id');
      const snapshot = createResumeEvaluationSnapshot(rawText);

      expect(result._unsafeUnwrap()?.resumeRedactedText).toBe(snapshot.text);
      expect(result._unsafeUnwrap()?.resumeRedactedText).not.toContain(
        'jane@example.com',
      );
      expect(tx.applicantEvaluation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            redactedResumeText: snapshot.text,
            redactedResumeHash: snapshot.hash,
            redactionVersion: snapshot.redactionVersion,
          }) as unknown,
        }),
      );
    });

    it('returns an error when the job hash does not match', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        jobContentHash: 'different-job-hash',
      });

      const result = await repository.claimForProcessing('evaluation-id');

      expect(result.isErr()).toBe(true);
      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation job snapshot hash does not match',
      );
    });

    it('returns an error when the resume hash does not match', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        resumeContentHash: 'different-resume-hash',
      });

      const result = await repository.claimForProcessing('evaluation-id');

      expect(result.isErr()).toBe(true);
      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation resume content hash does not match',
      );
    });

    it('returns an error when the parser version does not match', async () => {
      tx.applicantEvaluation.findUnique.mockResolvedValue({
        ...createProcessingEvaluation(),
        parserVersion: 'different-parser',
      });

      const result = await repository.claimForProcessing('evaluation-id');

      expect(result.isErr()).toBe(true);
      expect((result._unsafeUnwrapErr().cause as Error).message).toContain(
        'Evaluation parser version does not match',
      );
    });
  });

  describe('processing state transitions', () => {
    const completedInput: CompleteApplicantEvaluationInput = {
      evaluationPublicId: 'evaluation-id',
      overallScore: 88,
      scoreBreakdown: {
        schemaVersion: 1,
        skills: 90,
        experience: 85,
        education: 75,
        overallFit: 88,
      },
      evidence: {
        schemaVersion: 1,
        strengths: ['Strong TypeScript experience'],
        gaps: ['No PostgreSQL evidence'],
        explanation: 'The candidate matches most requirements.',
      },
    };

    it('stores the result and marks a processing evaluation completed', async () => {
      const result = await repository.markCompleted(completedInput);

      expect(result._unsafeUnwrap()).toBe(true);
      expect(prismaService.applicantEvaluation.updateMany).toHaveBeenCalledWith(
        {
          where: {
            publicId: completedInput.evaluationPublicId,
            status: EvaluationStatus.PROCESSING,
          },
          data: {
            status: EvaluationStatus.COMPLETED,
            overallScore: completedInput.overallScore,
            scoreBreakdown: completedInput.scoreBreakdown,
            evidence: completedInput.evidence,
            errorMessage: null,
            evaluatedAt: expect.any(Date) as Date,
          },
        },
      );
    });

    it('stores V2 evidence and its computed breakdown', async () => {
      const v2Input: CompleteApplicantEvaluationInput = {
        evaluationPublicId: 'evaluation-id',
        overallScore: 42,
        scoreBreakdown: {
          schemaVersion: 2,
          criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
        },
        evidence: {
          schemaVersion: 2,
          strengths: ['TypeScript'],
          gaps: [],
          explanation: 'Relevant skill found.',
          criteria: [
            {
              criterionId: 'skill:1',
              criterionText: 'TypeScript',
              verdict: 'PARTIAL',
              scoreContribution: 42,
              explanation: 'Skill is mentioned.',
              evidence: [
                {
                  snippet: 'TypeScript',
                  section: 'resume',
                  startOffset: 0,
                  endOffset: 10,
                },
              ],
            },
          ],
        },
      };

      expect((await repository.markCompleted(v2Input))._unsafeUnwrap()).toBe(
        true,
      );
      expect(prismaService.applicantEvaluation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scoreBreakdown: v2Input.scoreBreakdown,
            evidence: v2Input.evidence,
          }) as object,
        }),
      );
    });

    it('releases a processing evaluation for retry', async () => {
      const result = await repository.markPending(
        'evaluation-id',
        'Gemini unavailable',
      );

      expect(result._unsafeUnwrap()).toBe(true);
      expect(prismaService.applicantEvaluation.updateMany).toHaveBeenCalledWith(
        {
          where: {
            publicId: 'evaluation-id',
            status: {
              in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
            },
          },
          data: {
            status: EvaluationStatus.PENDING,
            errorMessage: 'Gemini unavailable',
            overallScore: null,
            scoreBreakdown: Prisma.DbNull,
            evidence: Prisma.DbNull,
            evaluatedAt: null,
          },
        },
      );
    });

    it('marks a processing evaluation permanently failed', async () => {
      const result = await repository.markFailed(
        'evaluation-id',
        'Invalid evaluation input',
      );

      expect(result._unsafeUnwrap()).toBe(true);
      expect(prismaService.applicantEvaluation.updateMany).toHaveBeenCalledWith(
        {
          where: {
            publicId: 'evaluation-id',
            status: {
              in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
            },
          },
          data: {
            status: EvaluationStatus.FAILED,
            errorMessage: 'Invalid evaluation input',
            overallScore: null,
            scoreBreakdown: Prisma.DbNull,
            evidence: Prisma.DbNull,
            evaluatedAt: null,
          },
        },
      );
    });

    it('returns false when the evaluation is no longer processing', async () => {
      prismaService.applicantEvaluation.updateMany.mockResolvedValue({
        count: 0,
      });

      const result = await repository.markCompleted(completedInput);

      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns an error when a state transition fails', async () => {
      prismaService.applicantEvaluation.updateMany.mockRejectedValue(
        new Error('database down'),
      );

      const result = await repository.markFailed(
        'evaluation-id',
        'Gemini unavailable',
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain(
        'Failed to fail applicant evaluation',
      );
    });
  });
});

describe('ApplicantEvaluationRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: ApplicantEvaluationRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    [
      'getApplicantEvaluationForJobOwner',
      (repository) =>
        repository.getApplicantEvaluationForJobOwner('evaluation', 'job'),
    ],
    [
      'getApplicantEvaluationDetail',
      (repository) =>
        repository.getApplicantEvaluationDetail('user', 'evaluation'),
    ],
    [
      'getRealtimeStateForApplicant',
      (repository) =>
        repository.getRealtimeStateForApplicant('user', 'evaluation'),
    ],
    ['prepare', (repository) => repository.prepare({} as never)],
    [
      'claimForProcessing',
      (repository) => repository.claimForProcessing('evaluation'),
    ],
    ['markCompleted', (repository) => repository.markCompleted({} as never)],
    [
      'markPending',
      (repository) => repository.markPending('evaluation', 'failed'),
    ],
    [
      'markFailed',
      (repository) => repository.markFailed('evaluation', 'failed'),
    ],
  ];

  describe.each([
    ['Error', new Error('private dependency payload')],
    ['non-Error', { message: 'private dependency payload', code: 'PRIVATE' }],
  ])('%s failures', (_kind, failure) => {
    it.each(operations)(
      'preserves the cause and hides dependency details in %s',
      async (_method, invoke) => {
        const delegate = {
          findUnique: jest.fn().mockRejectedValue(failure),
          findFirst: jest.fn().mockRejectedValue(failure),
          findMany: jest.fn().mockRejectedValue(failure),
          count: jest.fn().mockRejectedValue(failure),
          create: jest.fn().mockRejectedValue(failure),
          update: jest.fn().mockRejectedValue(failure),
          updateMany: jest.fn().mockRejectedValue(failure),
        };
        const repository = new ApplicantEvaluationRepository({
          applicantEvaluation: delegate,
          resume: delegate,
          $transaction: jest.fn().mockRejectedValue(failure),
        } as unknown as PrismaService);
        const error = (await invoke(repository))._unsafeUnwrapErr();
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain('private dependency payload');
        expect(error.message).not.toContain('[object Object]');
      },
    );
  });
});
