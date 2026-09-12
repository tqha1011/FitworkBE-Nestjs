import { PageResult } from 'src/shared/common/pagination';
import {
  JobDetailResponseDto,
  JobItemResponseDto,
} from '../dtos/job.response.dto';
import { Result } from 'neverthrow';

export type JobListFilter = {
  title?: string;
  categoryIds?: number[];
  skillIds?: number[];
  budgetMin?: number;
  budgetMax?: number;
};

export abstract class IJobQueryRepository {
  abstract getListJobs(
    pageNumber: number,
    pageSize: number,
    filter?: JobListFilter,
  ): Promise<Result<PageResult<JobItemResponseDto>, Error>>;

  abstract getJobDetails(
    jobPublicId: string,
  ): Promise<Result<JobDetailResponseDto | null, Error>>;
}
