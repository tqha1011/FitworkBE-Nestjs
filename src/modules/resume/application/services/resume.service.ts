import { Injectable } from '@nestjs/common';
import { IResumeService } from '../interfaces/resume.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { ResumeUploadResponseDto } from '../dtos/resume.response.dto';
import { UploadResumeRequestDto } from '../dtos/resume.request.dto';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { randomUUID } from 'crypto';
import { IResumeRepository } from '../../domain/repositories/resume.repo.interface';
import { CommonContentDisposition } from 'src/shared/domain/enum';

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
    private readonly resumeRepo: IResumeRepository,
  ) {}
  async getDownloadUrlAsync(
    resumePublicId: string,
    diposition: CommonContentDisposition,
  ): Promise<Result<string, AppError>> {
    const resumeStorageData =
      await this.resumeRepo.getResumeStorageData(resumePublicId);
    if (resumeStorageData.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          `Failed to get resume storage data: ${resumeStorageData.error}`,
        ),
      );
    }
    if (!resumeStorageData.value) {
      return err(new AppError(ErrorCode.NotFound, `Resume not found`));
    }
    const downloadUrl = await this.fileStorage.getDownloadUrl(
      resumeStorageData.value.storageKey,
      resumeStorageData.value.fileName,
      diposition,
    );
    if (downloadUrl.isErr()) {
      return err(downloadUrl.error);
    }
    return ok(downloadUrl.value);
  }

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
