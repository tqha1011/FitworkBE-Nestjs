import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import { ResumeUploadResponseDto } from '../dtos/resume.response.dto';
import { UploadResumeRequestDto } from '../dtos/resume.request.dto';

export abstract class IResumeService {
  abstract getUploadUrlAsync(
    userPublicId: string,
    resumeUploadRequest: UploadResumeRequestDto,
  ): Promise<Result<ResumeUploadResponseDto, AppError>>;
}
