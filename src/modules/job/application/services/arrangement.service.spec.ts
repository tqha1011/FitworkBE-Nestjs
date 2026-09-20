import { err, ok } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { IArrangementRepository } from '../../domain/repositories/arrangement.repo.interface';
import { ArrangementService } from './arrangement.service';

describe('ArrangementService', () => {
  const arrangements = [{ id: 1, name: 'Remote' }];

  let repository: { getAllArrangements: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  let service: ArrangementService;

  beforeEach(() => {
    repository = {
      getAllArrangements: jest.fn().mockResolvedValue(ok(arrangements)),
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new ArrangementService(
      repository as unknown as IArrangementRepository,
      cache as IApplicationCache,
    );
  });

  it('returns cached arrangements without querying the repository', async () => {
    cache.get.mockResolvedValue(arrangements);

    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrap()).toEqual(arrangements);
    expect(repository.getAllArrangements).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns a cached empty array without querying the repository', async () => {
    cache.get.mockResolvedValue([]);

    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(repository.getAllArrangements).not.toHaveBeenCalled();
  });

  it('caches repository arrangements for one hour after a miss', async () => {
    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrap()).toEqual(arrangements);
    expect(cache.get).toHaveBeenCalledWith(ReferenceDataCacheKey.Arrangements);
    expect(cache.set).toHaveBeenCalledWith(
      ReferenceDataCacheKey.Arrangements,
      arrangements,
      REFERENCE_DATA_CACHE_TTL_MS,
    );
  });

  it('falls back to the repository when reading cache fails', async () => {
    cache.get.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrap()).toEqual(arrangements);
    expect(repository.getAllArrangements).toHaveBeenCalled();
  });

  it('returns repository arrangements when writing cache fails', async () => {
    cache.set.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrap()).toEqual(arrangements);
  });

  it('maps repository errors to an internal error', async () => {
    repository.getAllArrangements.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.getAllArrangementsAsync();

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
