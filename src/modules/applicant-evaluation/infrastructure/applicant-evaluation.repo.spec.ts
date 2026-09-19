import { EvaluationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { PrepareApplicantEvaluationInput } from '../domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationRepository } from './applicant-evaluation.repo';

jest.mock('generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { DbNull: 'DbNull' },
}));

describe('ApplicantEvaluationRepository', () => {
  const input: PrepareApplicantEvaluationInput = {
    applicantPublicId: 'applicant-id',
    jobId: 10,
    resumeId: 20,
    resumeContentId: 30,
    jobSnapshot: {
      schemaVersion: 1,
      publicId: 'job-id',
      title: 'Backend Engineer',
      description: 'Build services',
      requirements: 'TypeScript',
      location: 'Remote',
      skills: [{ id: 1, name: 'TypeScript' }],
      category: { id: 2, name: 'Engineering' },
      arrangement: { id: 3, name: 'Remote' },
    },
    jobContentHash: 'job-hash',
    resumeContentHash: 'resume-hash',
    parserVersion: 'parser-v1',
    model: 'evaluation-model',
    promptVersion: 'applicant-match-v1',
  };

  let tx: {
    jobApplicant: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    applicantEvaluation: {
      upsert: jest.Mock;
      update: jest.Mock;
    };
  };
  let prismaService: { $transaction: jest.Mock };
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
      },
    };
    const runTransaction = async (
      callback: (transaction: typeof tx) => Promise<unknown>,
    ): Promise<unknown> => callback(tx);
    prismaService = {
      $transaction: jest.fn(runTransaction),
    };
    repository = new ApplicantEvaluationRepository(
      prismaService as unknown as PrismaService,
    );
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
});
