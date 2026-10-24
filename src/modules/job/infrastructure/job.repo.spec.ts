import { Job } from '../domain/entities/job.entity';
import { CommonCurrency } from 'src/shared/domain/enum';
import { CommonJobStatus } from 'src/shared/domain/enum';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { JobRepository } from './job.repo';
import { ok } from 'neverthrow';
import { JobApplicantStatus, JobStatus } from 'generated/prisma/enums';

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

  it('keeps the original search error without embedding its sensitive message', async () => {
    const failure = Object.assign(new Error('private query payload'), {
      code: 'P2021',
    });
    const repo = new JobRepository({
      job: {
        findMany: jest.fn().mockRejectedValue(failure),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService);
    const result = await repo.getListJobs(1, 20);
    expect(result._unsafeUnwrapErr().cause).toBe(failure);
    expect(result._unsafeUnwrapErr().message).not.toContain('private');
  });

  describe('authorizeJobOwner', () => {
    it('checks the job public ID and owner public ID', async () => {
      prismaService.job.findUnique.mockResolvedValue({ id: 10 });

      const result = await repository.authorizeJobOwner('owner-id', 'job-id');

      expect(result).toEqual(ok(undefined));
      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'job-id', user: { publicId: 'owner-id' } },
        select: { id: true },
      });
    });

    it('returns null for a different owner', async () => {
      prismaService.job.findUnique.mockResolvedValue(null);

      expect(
        (
          await repository.authorizeJobOwner('other-owner', 'job-id')
        )._unsafeUnwrap(),
      ).toBeNull();
    });
  });

  describe('getApplicationTarget', () => {
    it('returns the job status and whether an applicant is already accepted', async () => {
      prismaService.job.findUnique.mockResolvedValue({
        id: 10,
        status: JobStatus.OPEN,
        jobApplicants: [{ id: 7 }],
      });

      const result = await repository.getApplicationTarget('job-id');

      expect(result._unsafeUnwrap()).toEqual({
        jobId: 10,
        status: CommonJobStatus.OPEN,
        hasAcceptedApplicant: true,
      });
      expect(prismaService.job.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'job-id' },
        select: {
          id: true,
          status: true,
          jobApplicants: {
            where: {
              status: {
                in: [JobApplicantStatus.ACCEPTED, JobApplicantStatus.COMPLETED],
              },
            },
            select: { id: true },
            take: 1,
          },
        },
      });
    });

    it('returns null when the job does not exist', async () => {
      prismaService.job.findUnique.mockResolvedValue(null);

      const result = await repository.getApplicationTarget('missing-job');

      expect(result._unsafeUnwrap()).toBeNull();
    });
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

describe('JobRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: JobRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    [
      'authorizeJobOwner',
      (repository) => repository.authorizeJobOwner('user', 'job'),
    ],
    [
      'getJobDataForSnapshot',
      (repository) => repository.getJobDataForSnapshot('job'),
    ],
    ['getJobByPublicId', (repository) => repository.getJobByPublicId('job')],
    [
      'updateJob',
      (repository) =>
        repository.updateJob(
          Job.create({
            title: 'Engineer',
            description: 'Build APIs',
            requirements: 'TypeScript',
            location: 'Remote',
            status: CommonJobStatus.OPEN,
            budget: 100,
            currency: CommonCurrency.USD,
            postedBy: 1,
            categoryId: 1,
            arrangementId: 1,
            dueAt: new Date(Date.now() + 86400000),
          })._unsafeUnwrap(),
        ),
    ],
    ['getJobDetails', (repository) => repository.getJobDetails('job')],
    ['getListJobs', (repository) => repository.getListJobs(1, 20)],
    [
      'addJob',
      (repository) =>
        repository.addJob(
          Job.create({
            title: 'Engineer',
            description: 'Build APIs',
            requirements: 'TypeScript',
            location: 'Remote',
            status: CommonJobStatus.OPEN,
            budget: 100,
            currency: CommonCurrency.USD,
            postedBy: 1,
            categoryId: 1,
            arrangementId: 1,
            dueAt: new Date(Date.now() + 86400000),
          })._unsafeUnwrap(),
          [1],
        ),
    ],
    [
      'getApplicationTarget',
      (repository) => repository.getApplicationTarget('job'),
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
        const repository = new JobRepository({
          job: delegate,
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
