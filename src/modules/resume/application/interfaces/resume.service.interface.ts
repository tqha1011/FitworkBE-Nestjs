import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import {
  ResumeResponseDto,
  ResumeUploadResponseDto,
} from '../dtos/resume.response.dto';
import {
  CreateResumeRequestDto,
  UpdateResumeRequestDto,
  UploadResumeRequestDto,
} from '../dtos/resume.request.dto';
import { CommonContentDisposition } from 'src/shared/domain/enum';

export abstract class IResumeService {
  abstract getUploadUrlAsync(
    userPublicId: string,
    resumeUploadRequest: UploadResumeRequestDto,
  ): Promise<Result<ResumeUploadResponseDto, AppError>>;

  abstract getDownloadUrlAsync(
    userPublicId: string,
    resumePublicId: string,
    disposition: CommonContentDisposition,
  ): Promise<Result<string, AppError>>;

  abstract createResumeAsync(
    userPublicId: string,
    resumeCreateRequest: CreateResumeRequestDto,
  ): Promise<Result<ResumeResponseDto, AppError>>;

  abstract updateResumeAsync(
    userPublicId: string,
    resumePublicId: string,
    resumeUpdateRequest: UpdateResumeRequestDto,
  ): Promise<Result<ResumeResponseDto, AppError>>;

  abstract deleteResumeAsync(
    userPublicId: string,
    resumePublicId: string,
  ): Promise<Result<undefined, AppError>>;
}
