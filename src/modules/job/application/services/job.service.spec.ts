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
});
