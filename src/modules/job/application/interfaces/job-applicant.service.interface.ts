import { Result } from 'neverthrow';
import { JobApplicantRequestDto } from '../dtos/job.request.dto';
import { AppError } from 'src/shared/common/errorCode';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';

export abstract class IJobApplicantService {
  abstract applyJobAsync(
    userPublicId: string,
    jobPublicId: string,
    request: JobApplicantRequestDto,
  ): Promise<Result<undefined, AppError>>;

  abstract confirmJobApplicantAsync(
    actorPublicId: string,
    jobApplicantPublicId: string,
    nextStatus: CommonJobApplicantStatus,
  ): Promise<Result<undefined, AppError>>;
}
