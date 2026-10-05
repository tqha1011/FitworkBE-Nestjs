import { Result, ok, err } from 'neverthrow';
import {
  CategoryData,
  ICategoryRepository,
} from '../domain/repositories/category.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';

export class CategoryRepository implements ICategoryRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async getAllCategories(): Promise<Result<CategoryData[], Error>> {
    try {
      const categories = await this.prismaService.category.findMany({
        select: {
          id: true,
          name: true,
        },
      });
      return ok(categories);
    } catch (error) {
      return err(new Error('Failed to get all categories', { cause: error }));
    }
  }

  async categoryExists(categoryId: number): Promise<Result<boolean, Error>> {
    try {
      const count = await this.prismaService.category.count({
        where: { id: categoryId },
      });
      return ok(count > 0);
    } catch (error) {
      return err(
        new Error('Failed to check category exists', { cause: error }),
      );
    }
  }
}
