import { JobApplicantStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { JobApplicantRepository } from './job-applicant.repo';

describe('JobApplicantRepository getJobsAppliedAsync', () => {
  let prismaService: {
    jobApplicant: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let repository: JobApplicantRepository;

  beforeEach(() => {
    prismaService = {
      jobApplicant: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    repository = new JobApplicantRepository(
      prismaService as unknown as PrismaService,
    );
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
