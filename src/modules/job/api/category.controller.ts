import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { CategoryResponseDto } from '../application/dtos/job.response.dto';
import { ICategoryService } from '../application/interfaces/category.service.interface';

@Controller('categories')
@ApiTags('categories')
export class CategoryController {
  constructor(private readonly categoryService: ICategoryService) {}

  @Get()
  @ApiOperation({ summary: 'List job categories' })
  async getCategories(): Promise<CategoryResponseDto[]> {
    const result = await this.categoryService.getAllCategoriesAsync();
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
