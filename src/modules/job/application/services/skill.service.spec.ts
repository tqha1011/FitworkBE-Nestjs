import { err, ok } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { ISkillRepository } from '../../domain/repositories/skill.repo.interface';
import { SkillService } from './skill.service';

describe('SkillService', () => {
  const skills = [{ id: 1, name: 'TypeScript' }];

  let repository: { getAllSkills: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  let service: SkillService;

  beforeEach(() => {
    repository = {
      getAllSkills: jest.fn().mockResolvedValue(ok(skills)),
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new SkillService(
      repository as unknown as ISkillRepository,
      cache as IApplicationCache,
    );
  });

  it('returns cached skills without querying the repository', async () => {
    cache.get.mockResolvedValue(skills);

    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrap()).toEqual(skills);
    expect(repository.getAllSkills).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns a cached empty array without querying the repository', async () => {
    cache.get.mockResolvedValue([]);

    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(repository.getAllSkills).not.toHaveBeenCalled();
  });

  it('caches repository skills for one hour after a miss', async () => {
    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrap()).toEqual(skills);
    expect(cache.get).toHaveBeenCalledWith(ReferenceDataCacheKey.Skills);
    expect(cache.set).toHaveBeenCalledWith(
      ReferenceDataCacheKey.Skills,
      skills,
      REFERENCE_DATA_CACHE_TTL_MS,
    );
  });

  it('falls back to the repository when reading cache fails', async () => {
    cache.get.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrap()).toEqual(skills);
    expect(repository.getAllSkills).toHaveBeenCalled();
  });

  it('returns repository skills when writing cache fails', async () => {
    cache.set.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrap()).toEqual(skills);
  });

  it('maps repository errors to an internal error', async () => {
    repository.getAllSkills.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.getAllSkillsAsync();

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('keeps the repository cause without exposing dependency details', async () => {
    const failure = new Error('private dependency payload');
    repository.getAllSkills.mockResolvedValue(err(failure));
    const error = (await service.getAllSkillsAsync())._unsafeUnwrapErr();
    expect(error.cause).toBe(failure);
    expect(error.code).toBe(ErrorCode.InternalServerError);
    expect(error.message).not.toContain('private dependency payload');
  });
});
