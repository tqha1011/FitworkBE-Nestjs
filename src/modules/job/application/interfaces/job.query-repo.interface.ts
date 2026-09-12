import { PageResult } from 'src/shared/common/pagination';
import {
  JobDetailResponseDto,
  JobItemResponseDto,
} from '../dtos/job.response.dto';
import { Result } from 'neverthrow';

export abstract class IJobQueryRepository {
  abstract getListJobs(
    pageNumber: number,
    pageSize: number,
  ): Promise<Result<PageResult<JobItemResponseDto>, Error>>;

  abstract getJobDetails(
    jobPublicId: string,
  ): Promise<Result<JobDetailResponseDto | null, Error>>;
}
