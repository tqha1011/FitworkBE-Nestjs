import { Injectable } from '@nestjs/common';
import { IResumeService } from '../interfaces/resume.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { ResumeUploadResponseDto } from '../dtos/resume.response.dto';
import {
  CreateResumeRequestDto,
  UpdateResumeRequestDto,
  UploadResumeRequestDto,
} from '../dtos/resume.request.dto';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { randomUUID } from 'crypto';
import { IResumeRepository } from '../../domain/repositories/resume.repo.interface';
import {
  CommonContentDisposition,
  CommonFileType,
} from 'src/shared/domain/enum';
import { Resume } from '../../domain/entities/resume.entity';

export const extensionByContentType: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
};

const fileTypeByContentType: Record<string, CommonFileType> = {
  'application/pdf': CommonFileType.PDF,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    CommonFileType.DOCX,
};

type ResumeOwnerAction = 'update' | 'delete';

@Injectable()
export class ResumeService implements IResumeService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly fileStorage: IFileStorage,
    private readonly resumeRepo: IResumeRepository,
  ) {}

  async deleteResumeAsync(
    userPublicId: string,
    resumePublicId: string,
  ): Promise<Result<undefined, AppError>> {
    const authorizedResumeResult = await this.authorizeResumeOwnerAsync(
      userPublicId,
      resumePublicId,
      'delete',
    );
    if (authorizedResumeResult.isErr()) {
      return err(authorizedResumeResult.error);
    }

    const deleteResult = await this.resumeRepo.deleteResume(resumePublicId);
    if (deleteResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to delete resume'),
      );
    }
    return ok(undefined);
  }

  async updateResumeAsync(
    userPublicId: string,
    resumePublicId: string,
    resumeUpdateRequest: UpdateResumeRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const authorizedResumeResult = await this.authorizeResumeOwnerAsync(
      userPublicId,
      resumePublicId,
      'update',
    );
    if (authorizedResumeResult.isErr()) {
      return err(authorizedResumeResult.error);
    }

    const storageAuthorizationResult = this.authorizeStorageKeyOwner(
      resumeUpdateRequest.storageKey,
      userPublicId,
    );
    if (storageAuthorizationResult.isErr()) {
      return err(storageAuthorizationResult.error);
    }

    const metadataResult = await this.fileStorage.getObjectMetadata(
      resumeUpdateRequest.storageKey,
    );
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }
    if (!metadataResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Uploaded resume not found'));
    }

    const contentType = metadataResult.value.contentType;
    const fileType = contentType
      ? fileTypeByContentType[contentType]
      : undefined;
    const extension = contentType
      ? extensionByContentType[contentType]
      : undefined;
    if (!fileType || !extension) {
      return err(
        new AppError(
          ErrorCode.BadRequest,
          `Unsupported resume content type: ${contentType ?? 'unknown'}`,
        ),
      );
    }

    if (!resumeUpdateRequest.storageKey.endsWith(`/cv.${extension}`)) {
      return err(
        new AppError(
          ErrorCode.BadRequest,
          'Resume content type does not match its storage key',
        ),
      );
    }

    const updatedResumeResult = authorizedResumeResult.value.update({
      storagePath: resumeUpdateRequest.storageKey,
      fileSize: metadataResult.value.contentLength,
      fileType,
      fileName: resumeUpdateRequest.name.trim(),
    });
    if (updatedResumeResult.isErr()) {
      return err(
        new AppError(ErrorCode.BadRequest, updatedResumeResult.error.message),
      );
    }

    const updateResult = await this.resumeRepo.updateResume(
      updatedResumeResult.value,
    );
    if (updateResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to update resume'),
      );
    }

    return ok(undefined);
  }
  async createResumeAsync(
    userPublicId: string,
    resumeCreateRequest: CreateResumeRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const userIdResult = await this.resolveUserIdAsync(userPublicId);
    if (userIdResult.isErr()) {
      return err(userIdResult.error);
    }

    const storageAuthorizationResult = this.authorizeStorageKeyOwner(
      resumeCreateRequest.storageKey,
      userPublicId,
    );
    if (storageAuthorizationResult.isErr()) {
      return err(storageAuthorizationResult.error);
    }

    const metadataResult = await this.fileStorage.getObjectMetadata(
      resumeCreateRequest.storageKey,
    );
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }
    if (!metadataResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Uploaded resume not found'));
    }

    const contentType = metadataResult.value.contentType;
    const fileType = contentType
      ? fileTypeByContentType[contentType]
      : undefined;
    const extension = contentType
      ? extensionByContentType[contentType]
      : undefined;
    if (!fileType || !extension) {
      return err(
        new AppError(
          ErrorCode.BadRequest,
          `Unsupported resume content type: ${contentType ?? 'unknown'}`,
        ),
      );
    }

    if (!resumeCreateRequest.storageKey.endsWith(`/cv.${extension}`)) {
      return err(
        new AppError(
          ErrorCode.BadRequest,
          'Resume content type does not match its storage key',
        ),
      );
    }

    const resumeResult = Resume.create({
      storagePath: resumeCreateRequest.storageKey,
      fileSize: metadataResult.value.contentLength,
      fileType,
      fileName: resumeCreateRequest.name.trim(),
      userId: userIdResult.value,
    });
    if (resumeResult.isErr()) {
      return err(
        new AppError(ErrorCode.BadRequest, resumeResult.error.message),
      );
    }

    const addResult = await this.resumeRepo.addResume(resumeResult.value);
    if (addResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to create resume'),
      );
    }

    return ok(undefined);
  }
  async getDownloadUrlAsync(
    userPublicId: string,
    resumePublicId: string,
    disposition: CommonContentDisposition,
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
    if (resumeStorageData.value.ownerPublicId !== userPublicId) {
      return err(
        new AppError(
          ErrorCode.Forbidden,
          'You are not allowed to access this resume',
        ),
      );
    }
    const downloadUrl = await this.fileStorage.getDownloadUrl(
      resumeStorageData.value.storageKey,
      resumeStorageData.value.fileName,
      disposition,
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
      if (!userExists.value) {
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

  private async resolveUserIdAsync(
    userPublicId: string,
  ): Promise<Result<number, AppError>> {
    const userIdResult =
      await this.userRepository.resolvePublicIdToId(userPublicId);
    if (userIdResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to resolve user'),
      );
    }
    if (!userIdResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'User not found'));
    }

    return ok(userIdResult.value);
  }

  private async authorizeResumeOwnerAsync(
    userPublicId: string,
    resumePublicId: string,
    action: ResumeOwnerAction,
  ): Promise<Result<Resume, AppError>> {
    const [userIdResult, resumeResult] = await Promise.all([
      this.resolveUserIdAsync(userPublicId),
      this.resumeRepo.getResumeByPublicId(resumePublicId),
    ]);
    if (userIdResult.isErr()) {
      return err(userIdResult.error);
    }
    if (resumeResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to get resume'),
      );
    }
    if (!resumeResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Resume not found'));
    }
    if (resumeResult.value.userId !== userIdResult.value) {
      return err(
        new AppError(
          ErrorCode.Forbidden,
          `You are not allowed to ${action} this resume`,
        ),
      );
    }

    return ok(resumeResult.value);
  }

  private authorizeStorageKeyOwner(
    storageKey: string,
    userPublicId: string,
  ): Result<undefined, AppError> {
    if (!storageKey.startsWith(`user/${userPublicId}/`)) {
      return err(
        new AppError(
          ErrorCode.Forbidden,
          'The resume storage key does not belong to this user',
        ),
      );
    }

    return ok(undefined);
  }
}
