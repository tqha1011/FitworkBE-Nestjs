import { Result } from 'neverthrow';

export type CategoryData = {
  id: number;
  name: string;
};

export abstract class ICategoryRepository {
  abstract getAllCategories(): Promise<Result<CategoryData[], Error>>;
  abstract categoryExists(categoryId: number): Promise<Result<boolean, Error>>;
}
