import { Result } from 'neverthrow';
import { PageResult } from 'src/shared/common/pagination';
import { JobApplicantItemResponseDto } from '../dtos/job.response.dto';

export abstract class IJobApplicantQueryRepo {
  abstract getJobsAppliedAsync(
    userId: number,
    pageNumber: number,
    pageSize: number,
  ): Promise<Result<PageResult<JobApplicantItemResponseDto>, Error>>;
}
