import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { JobRepository } from './job.repo';

describe('JobRepository getJobsAppliedAsync', () => {
  let prismaService: {
    job: {
      findUnique: jest.Mock;
    };
  };
  let repository: JobRepository;

  beforeEach(() => {
    prismaService = {
      job: {
        findUnique: jest.fn(),
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
});
