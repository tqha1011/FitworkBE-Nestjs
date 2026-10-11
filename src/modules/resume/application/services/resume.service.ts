import { Injectable } from '@nestjs/common';
import { IResumeService } from '../interfaces/resume.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import {
  ResumeResponseDto,
  ResumeUploadResponseDto,
  ResumeReadResponseDto,
} from '../dtos/resume.response.dto';
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
import { IResumeIngestionQueue } from '../interfaces/resume-ingestion-queue.interface';
import { IResumeTextExtractor } from '../interfaces/resume-text-extractor.interface';
import { IResumeContentRepository } from '../../domain/repositories/resume-content.repo.interface';
import { IResumeIngestionNotifier } from '../interfaces/resume-ingestion-notifier.interface';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';
import { IResumeQueryRepository } from '../interfaces/resume.query-repo.interface';

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
    private readonly ingestionQueue: IResumeIngestionQueue,
    private readonly textExtractor: IResumeTextExtractor,
    private readonly contentRepository: IResumeContentRepository,
    private readonly notifier: IResumeIngestionNotifier,
    private readonly queryRepository: IResumeQueryRepository,
  ) {}

  async getResumesAsync(
    userPublicId: string,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<ResumeReadResponseDto>, AppError>> {
    const result = await this.queryRepository.getResumesForOwner(
      userPublicId,
      pagination,
    );
    return result.mapErr(
      (cause) =>
        new AppError(ErrorCode.InternalServerError, 'Failed to get resumes', {
          cause,
        }),
    );
  }

  async getResumeDetailAsync(
    userPublicId: string,
    resumePublicId: string,
  ): Promise<Result<ResumeReadResponseDto, AppError>> {
    const result = await this.queryRepository.getResumeDetailForOwner(
      userPublicId,
      resumePublicId,
    );
    if (result.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to get resume', {
          cause: result.error,
        }),
      );
    }
    if (!result.value) {
      return err(new AppError(ErrorCode.NotFound, 'Resume not found'));
    }
    return ok(result.value);
  }

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
        new AppError(ErrorCode.InternalServerError, 'Failed to delete resume', {
          cause: deleteResult.error,
        }),
      );
    }
    return ok(undefined);
  }

  async updateResumeAsync(
    userPublicId: string,
    resumePublicId: string,
    resumeUpdateRequest: UpdateResumeRequestDto,
  ): Promise<Result<ResumeResponseDto, AppError>> {
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
        new AppError(ErrorCode.BadRequest, updatedResumeResult.error.message, {
          cause: updatedResumeResult.error,
        }),
      );
    }

    const updatedResume = updatedResumeResult.value;
    const updateResult = await this.resumeRepo.updateResumeWithPendingContent(
      updatedResume,
      {
        storagePath: updatedResume.storagePath,
        fileSize: updatedResume.fileSize,
        fileType: updatedResume.fileType,
        fileName: updatedResume.fileName,
        parserVersion: this.textExtractor.parserVersion(updatedResume.fileType),
      },
    );
    if (updateResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to update resume', {
          cause: updateResult.error,
        }),
      );
    }

    const enqueueResult = await this.enqueueIngestion(updateResult.value);
    if (enqueueResult.isErr()) {
      return err(enqueueResult.error);
    }
    return ok(updateResult.value);
  }
  async createResumeAsync(
    userPublicId: string,
    resumeCreateRequest: CreateResumeRequestDto,
  ): Promise<Result<ResumeResponseDto, AppError>> {
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
        new AppError(ErrorCode.BadRequest, resumeResult.error.message, {
          cause: resumeResult.error,
        }),
      );
    }

    const resume = resumeResult.value;
    const addResult = await this.resumeRepo.addResumeWithPendingContent(
      resume,
      {
        storagePath: resume.storagePath,
        fileSize: resume.fileSize,
        fileType: resume.fileType,
        fileName: resume.fileName,
        parserVersion: this.textExtractor.parserVersion(resume.fileType),
      },
    );
    if (addResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to create resume', {
          cause: addResult.error,
        }),
      );
    }

    const enqueueResult = await this.enqueueIngestion(addResult.value);
    if (enqueueResult.isErr()) {
      return err(enqueueResult.error);
    }
    return ok(addResult.value);
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
          'Failed to get resume storage data',
          { cause: resumeStorageData.error },
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
            'Failed to check user exists',
            { cause: userExists.error },
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
          'Failed to get upload URL',
          { cause: error },
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
        new AppError(ErrorCode.InternalServerError, 'Failed to resolve user', {
          cause: userIdResult.error,
        }),
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
        new AppError(ErrorCode.InternalServerError, 'Failed to get resume', {
          cause: resumeResult.error,
        }),
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

  private async enqueueIngestion(
    reference: ResumeResponseDto,
  ): Promise<Result<undefined, AppError>> {
    if (reference.ingestionStatus === CommonResumeIngestionStatus.COMPLETED) {
      return ok(undefined);
    }

    try {
      await this.ingestionQueue.enqueue({
        resumePublicId: reference.publicId,
        resumeContentPublicId: reference.ingestionPublicId,
      });
      return ok(undefined);
    } catch (error) {
      const message = `Failed to enqueue resume ingestion: ${error instanceof Error ? error.message : String(error)}`;
      const failedResult = await this.contentRepository.markFailed(
        reference.ingestionPublicId,
        message,
      );
      if (failedResult.isOk() && failedResult.value) {
        await this.notifier.notify({
          resumePublicId: failedResult.value.resumePublicId,
          ingestionPublicId: failedResult.value.publicId,
          status: failedResult.value.status,
          errorMessage: failedResult.value.errorMessage ?? message,
          updatedAt: failedResult.value.updatedAt.toISOString(),
        });
      }
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to enqueue resume ingestion',
          { cause: error },
        ),
      );
    }
  }
}
