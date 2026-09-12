import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import {
  CreateJobRequestDto,
  GetJobListRequestDto,
} from '../dtos/job.request.dto';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';
import { JobItemResponseDto } from '../dtos/job.response.dto';

export abstract class IJobService {
  abstract createJobAsync(
    postedByPublicId: string,
    request: CreateJobRequestDto,
  ): Promise<Result<undefined, AppError>>;

  abstract searchJobsAsync(
    request: GetJobListRequestDto,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<JobItemResponseDto>, AppError>>;
}
