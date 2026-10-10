import { toHttpException } from 'src/shared/common/app-error.mapper';
import { err, ok } from 'neverthrow';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import {
  MAX_RESUME_FILE_SIZE,
  Resume,
} from '../../domain/entities/resume.entity';
import { IResumeRepository } from '../../domain/repositories/resume.repo.interface';
import { ResumeService } from './resume.service';
import { CommonFileType } from 'src/shared/domain/enum';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';
import { IResumeTextExtractor } from '../interfaces/resume-text-extractor.interface';
import { IResumeContentRepository } from '../../domain/repositories/resume-content.repo.interface';

describe('ResumeService', () => {
  const userPublicId = '8c6cf582-9a29-48ed-a31f-93f9d78bb701';
  const storageKey = `user/${userPublicId}/a2580d1e-b1c2-4f00-8638-482d67402d33/cv.pdf`;

  let userRepository: {
    resolvePublicIdToId: jest.MockedFunction<
      IUserRepository['resolvePublicIdToId']
    >;
  };
  let fileStorage: {
    getObjectMetadata: jest.MockedFunction<IFileStorage['getObjectMetadata']>;
  };
  let resumeRepository: {
    addResumeWithPendingContent: jest.MockedFunction<
      IResumeRepository['addResumeWithPendingContent']
    >;
    updateResumeWithPendingContent: jest.MockedFunction<
      IResumeRepository['updateResumeWithPendingContent']
    >;
    deleteResume: jest.MockedFunction<IResumeRepository['deleteResume']>;
    getResumeByPublicId: jest.MockedFunction<
      IResumeRepository['getResumeByPublicId']
    >;
  };
  let ingestionQueue: { enqueue: jest.Mock };
  let textExtractor: { parserVersion: jest.Mock };
  let contentRepository: { markFailed: jest.Mock };
  let notifier: { notify: jest.Mock };
  let service: ResumeService;

  beforeEach(() => {
    userRepository = {
      resolvePublicIdToId: jest.fn(),
    };
    fileStorage = {
      getObjectMetadata: jest.fn(),
    };
    resumeRepository = {
      addResumeWithPendingContent: jest.fn(),
      updateResumeWithPendingContent: jest.fn(),
      deleteResume: jest.fn(),
      getResumeByPublicId: jest.fn(),
    };
    ingestionQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    textExtractor = {
      parserVersion: jest.fn().mockReturnValue('pdf-parse@2.4.5/text-v1'),
    };
    contentRepository = { markFailed: jest.fn() };
    notifier = { notify: jest.fn() };
    service = new ResumeService(
      userRepository as unknown as IUserRepository,
      fileStorage as unknown as IFileStorage,
      resumeRepository as unknown as IResumeRepository,
      ingestionQueue,
      textExtractor as unknown as IResumeTextExtractor,
      contentRepository as unknown as IResumeContentRepository,
      notifier,
    );
  });

  describe('deleteResumeAsync', () => {
    const resumePublicId = 'b1ad7d9d-8c47-4fd3-b70b-c7d25b109e21';

    const restoreResume = (userId = 42) =>
      Resume.restore({
        id: 10,
        publicId: resumePublicId,
        storagePath: `user/${userPublicId}/old-upload/cv.pdf`,
        fileSize: 512,
        fileType: CommonFileType.PDF,
        fileName: 'Resume.pdf',
        isActive: true,
        userId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

    it('soft-deletes a resume owned by the user', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );
      resumeRepository.deleteResume.mockResolvedValue(ok(undefined));

      const result = await service.deleteResumeAsync(
        userPublicId,
        resumePublicId,
      );

      expect(result.isOk()).toBe(true);
      expect(resumeRepository.deleteResume).toHaveBeenCalledWith(
        resumePublicId,
      );
    });

    it('returns not found when the user does not exist', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(null));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );

      const result = await service.deleteResumeAsync(
        userPublicId,
        resumePublicId,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.NotFound);
      }
      expect(resumeRepository.deleteResume).not.toHaveBeenCalled();
    });

    it('returns not found when the resume does not exist or is inactive', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(ok(null));

      const result = await service.deleteResumeAsync(
        userPublicId,
        resumePublicId,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.NotFound);
      }
      expect(resumeRepository.deleteResume).not.toHaveBeenCalled();
    });

    it('rejects a delete from a user who does not own the resume', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume(99)),
      );

      const result = await service.deleteResumeAsync(
        userPublicId,
        resumePublicId,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.Forbidden);
      }
      expect(resumeRepository.deleteResume).not.toHaveBeenCalled();
    });

    it('maps repository failures to an internal server error', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );
      resumeRepository.deleteResume.mockResolvedValue(
        err(new Error('database unavailable')),
      );

      const result = await service.deleteResumeAsync(
        userPublicId,
        resumePublicId,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.InternalServerError);
      }
    });
  });

  describe('updateResumeAsync', () => {
    const resumePublicId = 'b1ad7d9d-8c47-4fd3-b70b-c7d25b109e21';
    const originalStorageKey = `user/${userPublicId}/old-upload/cv.pdf`;

    const restoreResume = (userId = 42) =>
      Resume.restore({
        id: 10,
        publicId: resumePublicId,
        storagePath: originalStorageKey,
        fileSize: 512,
        fileType: CommonFileType.PDF,
        fileName: 'Old Resume.pdf',
        isActive: true,
        userId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

    it('updates a resume using uploaded object metadata', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: 2048,
          lastModified: new Date(),
        }),
      );
      resumeRepository.updateResumeWithPendingContent.mockResolvedValue(
        ok({
          publicId: resumePublicId,
          ingestionPublicId: 'ingestion-id',
          ingestionStatus: CommonResumeIngestionStatus.PENDING,
        }),
      );

      const result = await service.updateResumeAsync(
        userPublicId,
        resumePublicId,
        {
          name: ' Updated Resume.pdf ',
          storageKey,
        },
      );

      expect(result.isOk()).toBe(true);
      expect(
        resumeRepository.updateResumeWithPendingContent,
      ).toHaveBeenCalledTimes(1);
      const updatedResume =
        resumeRepository.updateResumeWithPendingContent.mock.calls[0][0];
      expect(updatedResume.id).toBe(10);
      expect(updatedResume.publicId).toBe(resumePublicId);
      expect(updatedResume.userId).toBe(42);
      expect(updatedResume.storagePath).toBe(storageKey);
      expect(updatedResume.fileSize).toBe(2048);
      expect(updatedResume.fileType).toBe(CommonFileType.PDF);
      expect(updatedResume.fileName).toBe('Updated Resume.pdf');
    });

    it('rejects an update from a user who does not own the resume', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume(99)),
      );

      const result = await service.updateResumeAsync(
        userPublicId,
        resumePublicId,
        {
          name: 'Updated Resume.pdf',
          storageKey,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.Forbidden);
      }
      expect(fileStorage.getObjectMetadata).not.toHaveBeenCalled();
      expect(
        resumeRepository.updateResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('rejects a replacement storage key owned by another user', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );

      const result = await service.updateResumeAsync(
        userPublicId,
        resumePublicId,
        {
          name: 'Updated Resume.pdf',
          storageKey: 'user/another-user/upload-id/cv.pdf',
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.Forbidden);
      }
      expect(fileStorage.getObjectMetadata).not.toHaveBeenCalled();
      expect(
        resumeRepository.updateResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('maps domain validation failures to a bad request', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      resumeRepository.getResumeByPublicId.mockResolvedValue(
        ok(restoreResume()),
      );
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: MAX_RESUME_FILE_SIZE + 1,
          lastModified: new Date(),
        }),
      );

      const result = await service.updateResumeAsync(
        userPublicId,
        resumePublicId,
        {
          name: 'Updated Resume.pdf',
          storageKey,
        },
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.BadRequest);
      }
      expect(
        resumeRepository.updateResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });
  });

  describe('createResumeAsync', () => {
    it('creates a resume from the uploaded object metadata', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: 1024,
          lastModified: new Date(),
        }),
      );
      resumeRepository.addResumeWithPendingContent.mockResolvedValue(
        ok({
          publicId: 'resume-id',
          ingestionPublicId: 'ingestion-id',
          ingestionStatus: CommonResumeIngestionStatus.PENDING,
        }),
      );

      const result = await service.createResumeAsync(userPublicId, {
        name: ' Backend Resume.pdf ',
        storageKey,
      });

      expect(result.isOk()).toBe(true);
      expect(
        resumeRepository.addResumeWithPendingContent,
      ).toHaveBeenCalledTimes(1);

      const resume =
        resumeRepository.addResumeWithPendingContent.mock.calls[0][0];
      expect(resume.storagePath).toBe(storageKey);
      expect(resume.fileName).toBe('Backend Resume.pdf');
      expect(resume.fileSize).toBe(1024);
      expect(resume.fileType).toBe(CommonFileType.PDF);
      expect(resume.isActive).toBe(true);
      expect(resume.userId).toBe(42);
      expect(ingestionQueue.enqueue).toHaveBeenCalledWith({
        resumePublicId: 'resume-id',
        resumeContentPublicId: 'ingestion-id',
      });
    });

    it('rejects a storage key owned by another user', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.pdf',
        storageKey: 'user/another-user/upload-id/cv.pdf',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.Forbidden);
      }
      expect(fileStorage.getObjectMetadata).not.toHaveBeenCalled();
      expect(
        resumeRepository.addResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('rejects a create request when the uploaded object does not exist', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(ok(null));

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.pdf',
        storageKey,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.NotFound);
      }
      expect(
        resumeRepository.addResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('rejects an unsupported content type', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'text/plain',
          contentLength: 1024,
          lastModified: new Date(),
        }),
      );

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.txt',
        storageKey,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.BadRequest);
      }
      expect(
        resumeRepository.addResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('rejects an uploaded object larger than the domain limit', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: MAX_RESUME_FILE_SIZE + 1,
          lastModified: new Date(),
        }),
      );

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.pdf',
        storageKey,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.BadRequest);
      }
      expect(
        resumeRepository.addResumeWithPendingContent,
      ).not.toHaveBeenCalled();
    });

    it('maps repository failures to an internal server error', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: 1024,
          lastModified: new Date(),
        }),
      );
      resumeRepository.addResumeWithPendingContent.mockResolvedValue(
        err(new Error('database unavailable')),
      );

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.pdf',
        storageKey,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.InternalServerError);
      }
    });

    it('marks ingestion failed and returns an error when enqueue fails', async () => {
      userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
      fileStorage.getObjectMetadata.mockResolvedValue(
        ok({
          contentType: 'application/pdf',
          contentLength: 1024,
          lastModified: new Date(),
        }),
      );
      resumeRepository.addResumeWithPendingContent.mockResolvedValue(
        ok({
          publicId: 'resume-id',
          ingestionPublicId: 'ingestion-id',
          ingestionStatus: CommonResumeIngestionStatus.PENDING,
        }),
      );
      const failure = new Error('Redis unavailable');
      ingestionQueue.enqueue.mockRejectedValue(failure);
      contentRepository.markFailed.mockResolvedValue(
        ok({
          publicId: 'ingestion-id',
          resumePublicId: 'resume-id',
          status: CommonResumeIngestionStatus.FAILED,
          errorMessage: 'Failed to enqueue resume ingestion: Redis unavailable',
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.createResumeAsync(userPublicId, {
        name: 'Resume.pdf',
        storageKey,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe(ErrorCode.InternalServerError);
      }
      expect(result._unsafeUnwrapErr().cause).toBe(failure);
      expect(result._unsafeUnwrapErr().message).not.toContain(
        'Redis unavailable',
      );
      expect(contentRepository.markFailed).toHaveBeenCalledWith(
        'ingestion-id',
        expect.stringContaining('Redis unavailable'),
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CommonResumeIngestionStatus.FAILED,
        }),
      );
    });
  });

  it('keeps lookup failures private through HTTP mapping', async () => {
    const failure = new Error('private dependency payload');
    userRepository.resolvePublicIdToId.mockResolvedValue(err(failure));
    resumeRepository.getResumeByPublicId.mockResolvedValue(ok(null));
    const error = (
      await service.deleteResumeAsync(userPublicId, 'resume')
    )._unsafeUnwrapErr();
    const http = toHttpException(error);
    expect(error.cause).toBe(failure);
    expect(http.cause).toBe(error);
    expect(http.getStatus()).toBe(500);
    expect(JSON.stringify(http.getResponse())).not.toContain(
      'private dependency payload',
    );
    expect(JSON.stringify(http.getResponse())).not.toContain('cause');
  });

  it('keeps domain validation message and status with the original cause', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(42));
    fileStorage.getObjectMetadata.mockResolvedValue(
      ok({ contentType: 'application/pdf', contentLength: 0 }),
    );
    const error = (
      await service.createResumeAsync(userPublicId, {
        storageKey,
        name: 'Resume.pdf',
      })
    )._unsafeUnwrapErr();
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.message).toBe((error.cause as Error).message);
    expect(error.code).toBe(ErrorCode.BadRequest);
    expect(toHttpException(error).getStatus()).toBe(400);
  });
});
