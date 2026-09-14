import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { ICategoryService } from '../interfaces/category.service.interface';
import { ICategoryRepository } from '../../domain/repositories/category.repo.interface';
import { CategoryResponseDto } from '../dtos/job.response.dto';

@Injectable()
export class CategoryService implements ICategoryService {
  constructor(private readonly categoryRepository: ICategoryRepository) {}

  async getAllCategoriesAsync(): Promise<
    Result<CategoryResponseDto[], AppError>
  > {
    const result = await this.categoryRepository.getAllCategories();
    if (result.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, result.error.message),
      );
    }
    return ok(result.value);
  }
}
