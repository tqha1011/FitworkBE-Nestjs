import { Result } from 'neverthrow';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';
import { ResumeReadResponseDto } from '../dtos/resume.response.dto';

export abstract class IResumeQueryRepository {
  abstract getResumesForOwner(
    ownerPublicId: string,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<ResumeReadResponseDto>, Error>>;

  abstract getResumeDetailForOwner(
    ownerPublicId: string,
    resumePublicId: string,
  ): Promise<Result<ResumeReadResponseDto | null, Error>>;
}
