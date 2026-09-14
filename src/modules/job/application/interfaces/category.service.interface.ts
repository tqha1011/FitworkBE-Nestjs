import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import { CategoryResponseDto } from '../dtos/job.response.dto';

export abstract class ICategoryService {
  abstract getAllCategoriesAsync(): Promise<
    Result<CategoryResponseDto[], AppError>
  >;
}
