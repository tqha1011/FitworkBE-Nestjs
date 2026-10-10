import { IJobApplicantQueryRepo } from '../interfaces/job-applicant.query-repo.interface';
import { Job } from '../../domain/entities/job.entity';
import { CommonCurrency, CommonJobStatus } from 'src/shared/domain/enum';
import { JobRepository } from '../../infrastructure/job.repo';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { err, ok } from 'neverthrow';
import { IJobQueryRepository } from '../interfaces/job.query-repo.interface';
import { IJobRepository } from '../../domain/repositories/job.repo.interface';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { ISkillRepository } from '../../domain/repositories/skill.repo.interface';
import { ICategoryRepository } from '../../domain/repositories/category.repo.interface';
import { IArrangementRepository } from '../../domain/repositories/arrangement.repo.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import { PageResult } from 'src/shared/common/pagination';
import { JobService } from './job.service';
import { toHttpException } from 'src/shared/common/app-error.mapper';

describe('JobService getJobsAppliedAsync', () => {
  let userRepository: { resolvePublicIdToId: jest.Mock };
  let applicantQueryRepo: { getJobsAppliedAsync: jest.Mock };
  let service: JobService;

  beforeEach(() => {
    userRepository = { resolvePublicIdToId: jest.fn() };
    applicantQueryRepo = { getJobsAppliedAsync: jest.fn() };
    service = new JobService(
      {} as IJobRepository,
      {} as IJobQueryRepository,
      applicantQueryRepo,
      userRepository as unknown as IUserRepository,
      {} as ISkillRepository,
      {} as ICategoryRepository,
      {} as IArrangementRepository,
    );
  });

  it('resolves the user and returns the repository page', async () => {
    const page = new PageResult([], 0, 1, 20);
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
    applicantQueryRepo.getJobsAppliedAsync.mockResolvedValue(ok(page));

    const result = await service.getJobsAppliedAsync('user-id', {
      pageNumber: 1,
      pageSize: 20,
    });

    expect(applicantQueryRepo.getJobsAppliedAsync).toHaveBeenCalledWith(
      42,
      1,
      20,
    );
    expect(result._unsafeUnwrap()).toBe(page);
  });

  it('returns not found when the current user does not exist', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(null));

    const result = await service.getJobsAppliedAsync('missing-user', {
      pageNumber: 1,
      pageSize: 20,
    });

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    expect(applicantQueryRepo.getJobsAppliedAsync).not.toHaveBeenCalled();
  });

  it('maps repository failures to an internal server error', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
    applicantQueryRepo.getJobsAppliedAsync.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.getJobsAppliedAsync('user-id', {
      pageNumber: 1,
      pageSize: 20,
    });

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
  });

  it('keeps the search repository failure through HTTP error mapping', async () => {
    const failure = new Error('database unavailable');
    const repo = { getListJobs: jest.fn().mockResolvedValue(err(failure)) };
    const search = new JobService(
      {} as IJobRepository,
      repo as unknown as IJobQueryRepository,
      applicantQueryRepo,
      userRepository as unknown as IUserRepository,
      {} as ISkillRepository,
      {} as ICategoryRepository,
      {} as IArrangementRepository,
    );
    const result = await search.searchJobsAsync({} as never, {
      pageNumber: 1,
      pageSize: 20,
    });
    expect(toHttpException(result._unsafeUnwrapErr()).cause).toEqual(
      expect.objectContaining({ cause: failure }),
    );
  });

  it('keeps the applicant lookup failure as cause', async () => {
    const failure = new Error('private dependency payload');
    userRepository.resolvePublicIdToId.mockResolvedValue(err(failure));
    const error = (
      await service.getJobsAppliedAsync('user', { pageNumber: 1, pageSize: 20 })
    )._unsafeUnwrapErr();
    expect(error.cause).toBe(failure);
    expect(error.message).not.toContain('private dependency payload');
  });

  it('keeps the applied-jobs query failure as cause', async () => {
    const failure = new Error('private dependency payload');
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(1));
    applicantQueryRepo.getJobsAppliedAsync.mockResolvedValue(err(failure));
    const error = (
      await service.getJobsAppliedAsync('user', { pageNumber: 1, pageSize: 20 })
    )._unsafeUnwrapErr();
    expect(error.cause).toBe(failure);
    expect(error.message).not.toContain('private dependency payload');
  });

  it('retains the database cause through repository, service and HTTP boundaries', async () => {
    const failure = new Error('private query payload');
    const repository = new JobRepository({
      job: {
        findMany: jest.fn().mockRejectedValue(failure),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService);
    const search = new JobService(
      {} as IJobRepository,
      repository,
      applicantQueryRepo,
      userRepository as unknown as IUserRepository,
      {} as ISkillRepository,
      {} as ICategoryRepository,
      {} as IArrangementRepository,
    );
    const error = (
      await search.searchJobsAsync({} as never, { pageNumber: 1, pageSize: 20 })
    )._unsafeUnwrapErr();
    const http = toHttpException(error);
    expect(http.cause).toBe(error);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).cause).toBe(failure);
    expect(http.getStatus()).toBe(500);
    expect(JSON.stringify(http.getResponse())).not.toContain(
      'private query payload',
    );
    expect(JSON.stringify(http.getResponse())).not.toContain('cause');
  });
});

describe('JobService create/update error causes', () => {
  const request = {
    title: 'Engineer',
    description: 'Build APIs',
    requirements: 'TypeScript',
    location: 'Remote',
    status: CommonJobStatus.OPEN,
    budget: 100,
    currency: CommonCurrency.USD,
    categoryId: 1,
    arrangementId: 1,
    dueAt: new Date(Date.now() + 86400000),
    skillsId: [1],
  };
  let service: JobService;
  let userRepository: { resolvePublicIdToId: jest.Mock };
  let jobRepository: {
    addJob: jest.Mock;
    getJobByPublicId: jest.Mock;
    updateJob: jest.Mock;
  };
  let categoryRepository: { categoryExists: jest.Mock };
  let arrangementRepository: { arrangementExists: jest.Mock };
  let skillRepository: { findExistingSkillIds: jest.Mock };

  beforeEach(() => {
    userRepository = {
      resolvePublicIdToId: jest.fn().mockResolvedValue(ok(1)),
    };
    jobRepository = {
      addJob: jest.fn().mockResolvedValue(ok(undefined)),
      getJobByPublicId: jest
        .fn()
        .mockResolvedValue(
          ok(Job.create({ ...request, postedBy: 1 })._unsafeUnwrap()),
        ),
      updateJob: jest.fn().mockResolvedValue(ok(undefined)),
    };
    categoryRepository = {
      categoryExists: jest.fn().mockResolvedValue(ok(true)),
    };
    arrangementRepository = {
      arrangementExists: jest.fn().mockResolvedValue(ok(true)),
    };
    skillRepository = {
      findExistingSkillIds: jest.fn().mockResolvedValue(ok([1])),
    };
    service = new JobService(
      jobRepository as unknown as IJobRepository,
      {} as IJobQueryRepository,
      {} as IJobApplicantQueryRepo,
      userRepository as unknown as IUserRepository,
      skillRepository as unknown as ISkillRepository,
      categoryRepository as unknown as ICategoryRepository,
      arrangementRepository as unknown as IArrangementRepository,
    );
  });

  it.each(['user', 'category', 'arrangement', 'skills', 'save'])(
    'preserves create %s errors without exposing their payload',
    async (stage) => {
      const failure = new Error('private dependency payload');
      const dependencies: Record<string, jest.Mock> = {
        user: userRepository.resolvePublicIdToId,
        category: categoryRepository.categoryExists,
        arrangement: arrangementRepository.arrangementExists,
        skills: skillRepository.findExistingSkillIds,
        save: jobRepository.addJob,
      };
      dependencies[stage].mockResolvedValue(err(failure));
      const error = (
        await service.createJobAsync('user', request)
      )._unsafeUnwrapErr();
      expect(error.cause).toBe(failure);
      expect(error.code).toBe(ErrorCode.InternalServerError);
      expect(error.message).not.toContain('private dependency payload');
    },
  );

  it.each(['user', 'load', 'save'])(
    'preserves update %s errors without exposing their payload',
    async (stage) => {
      const failure = new Error('private dependency payload');
      const dependencies: Record<string, jest.Mock> = {
        user: userRepository.resolvePublicIdToId,
        load: jobRepository.getJobByPublicId,
        save: jobRepository.updateJob,
      };
      dependencies[stage].mockResolvedValue(err(failure));
      const error = (
        await service.updateJobAsync('user', 'job', { title: 'Updated' })
      )._unsafeUnwrapErr();
      expect(error.cause).toBe(failure);
      expect(error.code).toBe(ErrorCode.InternalServerError);
      expect(error.message).not.toContain('private dependency payload');
    },
  );

  it.each(['create', 'update'])(
    'retains %s validation diagnostics and the HTTP status',
    async (action) => {
      const result =
        action === 'create'
          ? await service.createJobAsync('user', { ...request, budget: -1 })
          : await service.updateJobAsync('user', 'job', { budget: -1 });
      const error = result._unsafeUnwrapErr();
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.message).toBe((error.cause as Error).message);
      expect(toHttpException(error).getStatus()).toBe(400);
    },
  );

  it('keeps successful create and update behavior', async () => {
    expect(
      (await service.createJobAsync('user', request))._unsafeUnwrap(),
    ).toBeUndefined();
    expect(
      (
        await service.updateJobAsync('user', 'job', { title: 'Updated' })
      )._unsafeUnwrap(),
    ).toBeUndefined();
  });
});
