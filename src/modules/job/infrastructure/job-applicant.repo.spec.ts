import { JobApplicant } from '../domain/entities/job-applicant.entity';
import { JobApplicantStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { JobApplicantRepository } from './job-applicant.repo';

describe('JobApplicantRepository', () => {
  let prismaService: {
    jobApplicant: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let repository: JobApplicantRepository;

  beforeEach(() => {
    prismaService = {
      jobApplicant: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    repository = new JobApplicantRepository(
      prismaService as unknown as PrismaService,
    );
  });

  describe('getStatusContext', () => {
    it('returns status context for an application', async () => {
      prismaService.jobApplicant.findUnique.mockResolvedValue({
        jobId: 10,
        status: JobApplicantStatus.PENDING,
        job: { postedBy: 20, version: 3, jobApplicants: [] },
      });

      const result = await repository.getStatusContext('application-id');

      expect(result._unsafeUnwrap()).toEqual({
        jobId: 10,
        jobOwnerId: 20,
        status: CommonJobApplicantStatus.PENDING,
        version: 3,
        hasAcceptedApplicant: false,
      });
      expect(prismaService.jobApplicant.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'application-id' },
        select: {
          jobId: true,
          status: true,
          job: {
            select: {
              postedBy: true,
              version: true,
              jobApplicants: {
                where: {
                  status: {
                    in: [
                      JobApplicantStatus.ACCEPTED,
                      JobApplicantStatus.COMPLETED,
                    ],
                  },
                },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
    });

    it('reports when the job already has an accepted applicant', async () => {
      prismaService.jobApplicant.findUnique.mockResolvedValue({
        jobId: 10,
        status: JobApplicantStatus.PENDING,
        job: { postedBy: 20, version: 3, jobApplicants: [{ id: 7 }] },
      });

      const result = await repository.getStatusContext('application-id');

      expect(result._unsafeUnwrap()).toMatchObject({
        hasAcceptedApplicant: true,
      });
    });

    it('returns null when application does not exist', async () => {
      prismaService.jobApplicant.findUnique.mockResolvedValue(null);

      const result = await repository.getStatusContext('missing-id');

      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns error when Prisma cannot load status context', async () => {
      prismaService.jobApplicant.findUnique.mockRejectedValue(
        new Error('database unavailable'),
      );

      const result = await repository.getStatusContext('application-id');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain(
        'Failed to get job applicant status context',
      );
    });
  });

  describe('transitionStatus', () => {
    it('updates status only when current status still matches', async () => {
      prismaService.jobApplicant.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.transitionStatus(
        'application-id',
        10,
        CommonJobApplicantStatus.PENDING,
        CommonJobApplicantStatus.ACCEPTED,
      );

      expect(result._unsafeUnwrap()).toBe(true);
      expect(prismaService.jobApplicant.updateMany).toHaveBeenCalledWith({
        where: {
          publicId: 'application-id',
          jobId: 10,
          status: JobApplicantStatus.PENDING,
        },
        data: { status: JobApplicantStatus.ACCEPTED },
      });
    });

    it('returns false when current status changed concurrently', async () => {
      prismaService.jobApplicant.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.transitionStatus(
        'application-id',
        10,
        CommonJobApplicantStatus.PENDING,
        CommonJobApplicantStatus.ACCEPTED,
      );

      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('returns error when Prisma cannot transition status', async () => {
      prismaService.jobApplicant.updateMany.mockRejectedValue(
        new Error('database unavailable'),
      );

      const result = await repository.transitionStatus(
        'application-id',
        10,
        CommonJobApplicantStatus.PENDING,
        CommonJobApplicantStatus.ACCEPTED,
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain(
        'Failed to transition job applicant status',
      );
    });
  });

  describe('acceptApplicantAndRejectOthers', () => {
    const accept = (applicantUpdate: jest.Mock) =>
      new JobApplicantRepository({
        $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            job: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            jobApplicant: { updateMany: applicantUpdate },
          }),
      } as unknown as PrismaService).acceptApplicantAndRejectOthers(
        'application-id',
        10,
        CommonJobApplicantStatus.PENDING,
        3,
      );

    it('returns false when the one-accepted-per-job index rejects the accept', async () => {
      const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.8.0' },
      );

      const result = await accept(jest.fn().mockRejectedValue(uniqueViolation));

      expect(result._unsafeUnwrap()).toBe(false);
    });

    it('still returns an error for other Prisma failures', async () => {
      const failure = new Prisma.PrismaClientKnownRequestError('Timed out', {
        code: 'P1008',
        clientVersion: '7.8.0',
      });

      const result = await accept(jest.fn().mockRejectedValue(failure));

      expect(result._unsafeUnwrapErr().cause).toBe(failure);
    });
  });

  it('returns a paginated list of applications', async () => {
    const appliedAt = new Date('2026-09-19T00:00:00.000Z');
    prismaService.jobApplicant.findMany.mockResolvedValue([
      {
        status: JobApplicantStatus.PENDING,
        proposedRate: { toNumber: () => 1_500_000 },
        estimatedDay: 5,
        appliedAt,
        job: { publicId: 'job-id' },
        resume: { publicId: 'resume-id' },
        evaluations: [{ overallScore: 87 }],
      },
    ]);
    prismaService.jobApplicant.count.mockResolvedValue(3);

    const result = await repository.getJobsAppliedAsync(42, 2, 2);

    expect(result.isOk()).toBe(true);
    expect(prismaService.jobApplicant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicantId: 42 },
        take: 2,
        skip: 2,
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(prismaService.jobApplicant.count).toHaveBeenCalledWith({
      where: { applicantId: 42 },
    });
    expect(result._unsafeUnwrap()).toEqual({
      items: [
        {
          jobPublicId: 'job-id',
          status: CommonJobApplicantStatus.PENDING,
          resumePublicId: 'resume-id',
          proposedRate: 1_500_000,
          estimatedDays: 5,
          appliedAt,
          matchingScore: 87,
        },
      ],
      totalPages: 2,
      pageNumber: 2,
      pageSize: 2,
      hasPrevious: true,
      hasNext: false,
    });
  });

  it('uses zero when an application has not been scored', async () => {
    prismaService.jobApplicant.findMany.mockResolvedValue([
      {
        status: JobApplicantStatus.PENDING,
        proposedRate: { toNumber: () => 100 },
        estimatedDay: 1,
        appliedAt: new Date('2026-09-19T00:00:00.000Z'),
        job: { publicId: 'job-id' },
        resume: { publicId: 'resume-id' },
        evaluations: [],
      },
    ]);
    prismaService.jobApplicant.count.mockResolvedValue(1);

    const result = await repository.getJobsAppliedAsync(42, 1, 20);

    expect(result._unsafeUnwrap().items[0].matchingScore).toBe(0);
  });

  it('returns an error when Prisma cannot load applications', async () => {
    prismaService.jobApplicant.findMany.mockRejectedValue(
      new Error('database unavailable'),
    );
    prismaService.jobApplicant.count.mockResolvedValue(0);

    const result = await repository.getJobsAppliedAsync(42, 1, 20);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain(
      'Failed to get jobs applied',
    );
  });
});

describe('JobApplicantRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: JobApplicantRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    [
      'acceptApplicantAndRejectOthers',
      (repository) =>
        repository.acceptApplicantAndRejectOthers(
          'application',
          1,
          CommonJobApplicantStatus.PENDING,
          1,
        ),
    ],
    [
      'getStatusContext',
      (repository) => repository.getStatusContext('application'),
    ],
    [
      'transitionStatus',
      (repository) =>
        repository.transitionStatus(
          'application',
          1,
          CommonJobApplicantStatus.PENDING,
          CommonJobApplicantStatus.REJECTED,
        ),
    ],
    [
      'getJobsAppliedAsync',
      (repository) => repository.getJobsAppliedAsync(1, 1, 20),
    ],
    [
      'addJobApplicant',
      (repository) =>
        repository.addJobApplicant(
          JobApplicant.create({
            jobId: 1,
            applicantId: 2,
            resumeId: 3,
            coverLetter: 'Hello',
            proposedRate: 100,
            estimatedDay: 1,
          })._unsafeUnwrap(),
        ),
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
        const repository = new JobApplicantRepository({
          jobApplicant: delegate,
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
