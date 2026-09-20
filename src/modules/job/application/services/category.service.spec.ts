import { err, ok } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { ICategoryRepository } from '../../domain/repositories/category.repo.interface';
import { CategoryService } from './category.service';

describe('CategoryService', () => {
  const categories = [{ id: 1, name: 'Engineering' }];

  let repository: { getAllCategories: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
  let service: CategoryService;

  beforeEach(() => {
    repository = {
      getAllCategories: jest.fn().mockResolvedValue(ok(categories)),
    };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new CategoryService(
      repository as unknown as ICategoryRepository,
      cache as IApplicationCache,
    );
  });

  it('returns cached categories without querying the repository', async () => {
    cache.get.mockResolvedValue(categories);

    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrap()).toEqual(categories);
    expect(repository.getAllCategories).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns a cached empty array without querying the repository', async () => {
    cache.get.mockResolvedValue([]);

    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(repository.getAllCategories).not.toHaveBeenCalled();
  });

  it('caches repository categories for one hour after a miss', async () => {
    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrap()).toEqual(categories);
    expect(cache.get).toHaveBeenCalledWith(ReferenceDataCacheKey.Categories);
    expect(cache.set).toHaveBeenCalledWith(
      ReferenceDataCacheKey.Categories,
      categories,
      REFERENCE_DATA_CACHE_TTL_MS,
    );
  });

  it('falls back to the repository when reading cache fails', async () => {
    cache.get.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrap()).toEqual(categories);
    expect(repository.getAllCategories).toHaveBeenCalled();
  });

  it('returns repository categories when writing cache fails', async () => {
    cache.set.mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrap()).toEqual(categories);
  });

  it('maps repository errors to an internal error', async () => {
    repository.getAllCategories.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.getAllCategoriesAsync();

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
