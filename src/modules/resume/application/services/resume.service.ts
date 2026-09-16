import { Injectable } from '@nestjs/common';
import { IResumeService } from '../interfaces/resume.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { ResumeUploadResponseDto } from '../dtos/resume.response.dto';
import { UploadResumeRequestDto } from '../dtos/resume.request.dto';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { randomUUID } from 'crypto';

export const extensionByContentType: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
};

@Injectable()
export class ResumeService implements IResumeService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly fileStorage: IFileStorage,
  ) {}
  async getUploadUrlAsync(
    userPublicId: string,
    resumeUploadRequest: UploadResumeRequestDto,
  ): Promise<Result<ResumeUploadResponseDto, AppError>> {
    try {
      const userExists =
        await this.userRepository.checkUserExistsByPublicId(userPublicId);
      if (userExists.isErr()) {
        return err(
          new AppError(
            ErrorCode.InternalServerError,
            `Failed to check user exists: ${userExists.error}`,
          ),
        );
      }
      if (!userExists) {
        return err(new AppError(ErrorCode.NotFound, `User not found`));
      }
      const extension = extensionByContentType[resumeUploadRequest.contentType];
      if (!extension) {
        return err(
          new AppError(
            ErrorCode.BadRequest,
            `Unsupported content type: ${resumeUploadRequest.contentType}`,
          ),
        );
      }
      const storageKey = this.buildStorageKey(userPublicId, extension);
      const presigned = await this.fileStorage.getUploadUrl({
        key: storageKey,
        contentType: resumeUploadRequest.contentType,
        contentLength: resumeUploadRequest.fileSize,
      });
      if (presigned.isErr()) {
        return err(presigned.error);
      }
      return ok({
        uploadUrl: presigned.value.uploadUrl,
        storageKey: storageKey,
        expiresAt: presigned.value.expiresAt,
      });
    } catch (error) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to get upload URL: ${error}`,
        ),
      );
    }
  }

  private buildStorageKey(userPublicId: string, extension: string): string {
    const uuid = randomUUID();
    return `user/${userPublicId}/${uuid}/cv.${extension}`;
  }
}
