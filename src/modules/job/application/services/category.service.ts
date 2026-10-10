import { Injectable, Logger } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { ICategoryService } from '../interfaces/category.service.interface';
import { ICategoryRepository } from '../../domain/repositories/category.repo.interface';
import { CategoryResponseDto } from '../dtos/job.response.dto';

@Injectable()
export class CategoryService implements ICategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly cache: IApplicationCache,
  ) {}

  async getAllCategoriesAsync(): Promise<
    Result<CategoryResponseDto[], AppError>
  > {
    try {
      const cached = await this.cache.get<CategoryResponseDto[]>(
        ReferenceDataCacheKey.Categories,
      );
      if (cached !== undefined) {
        return ok(cached);
      }
    } catch (error) {
      this.logger.error(`Failed to read categories cache: ${String(error)}`);
    }

    const result = await this.categoryRepository.getAllCategories();
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get all categories',
          { cause: result.error },
        ),
      );
    }

    try {
      await this.cache.set(
        ReferenceDataCacheKey.Categories,
        result.value,
        REFERENCE_DATA_CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.error(`Failed to write categories cache: ${String(error)}`);
    }

    return ok(result.value);
  }
}
