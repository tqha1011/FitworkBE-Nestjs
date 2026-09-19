import { JobApplicantStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { JobRepository } from './job.repo';

describe('JobRepository getJobsAppliedAsync', () => {
  let prismaService: {
    job: {
      findUnique: jest.Mock;
    };
    jobApplicant: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let repository: JobRepository;

  beforeEach(() => {
    prismaService = {
      job: {
        findUnique: jest.fn(),
      },
      jobApplicant: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    repository = new JobRepository(prismaService as unknown as PrismaService);
  });

  describe('getJobDataForSnapshot', () => {
    it('returns deterministic matching data and keeps the database id outside the snapshot', async () => {
      prismaService.job.findUnique.mockResolvedValue({
        id: 10,
        publicId: 'job-id',
        title: 'Backend Engineer',
        description: 'Build backend services',
        requirements: 'Three years of TypeScript experience',
        location: 'Remote',
        jobSkills: [
          { skill: { id: 1, name: 'TypeScript' } },
          { skill: { id: 2, name: 'NestJS' } },
        ],
        category: { id: 3, name: 'Software Development' },
        arrangement: { id: 4, name: 'Remote' },
      });

      const result = await repository.getJobDataForSnapshot('job-id');

      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'job-id' },
        select: {
          id: true,
          publicId: true,
          title: true,
          description: true,
          requirements: true,
          location: true,
          jobSkills: {
            select: {
              skill: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { skillId: 'asc' },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          arrangement: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      expect(result._unsafeUnwrap()).toEqual({
        jobId: 10,
        snapshot: {
          schemaVersion: 1,
          publicId: 'job-id',
          title: 'Backend Engineer',
          description: 'Build backend services',
          requirements: 'Three years of TypeScript experience',
          location: 'Remote',
          skills: [
            { id: 1, name: 'TypeScript' },
            { id: 2, name: 'NestJS' },
          ],
          category: { id: 3, name: 'Software Development' },
          arrangement: { id: 4, name: 'Remote' },
        },
      });
    });

    it('returns null when the job does not exist', async () => {
      prismaService.job.findUnique.mockResolvedValue(null);

      const result = await repository.getJobDataForSnapshot('missing-job');

      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns an error when Prisma cannot load snapshot data', async () => {
      prismaService.job.findUnique.mockRejectedValue(
        new Error('database unavailable'),
      );

      const result = await repository.getJobDataForSnapshot('job-id');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain(
        'Failed to get job data for snapshot',
      );
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
