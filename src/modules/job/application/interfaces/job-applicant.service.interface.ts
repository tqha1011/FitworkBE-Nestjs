import { Result } from 'neverthrow';
import { JobApplicantRequestDto } from '../dtos/job.request.dto';
import { AppError } from 'src/shared/common/errorCode';

export abstract class IJobApplicantService {
  abstract applyJobAsync(
    userPublicId: string,
    jobPublicId: string,
    request: JobApplicantRequestDto,
  ): Promise<Result<undefined, AppError>>;
}
