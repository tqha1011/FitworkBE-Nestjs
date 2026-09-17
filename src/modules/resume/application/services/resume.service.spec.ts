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
    addResume: jest.MockedFunction<IResumeRepository['addResume']>;
    updateResume: jest.MockedFunction<IResumeRepository['updateResume']>;
    deleteResume: jest.MockedFunction<IResumeRepository['deleteResume']>;
    getResumeByPublicId: jest.MockedFunction<
      IResumeRepository['getResumeByPublicId']
    >;
  };
  let service: ResumeService;

  beforeEach(() => {
    userRepository = {
      resolvePublicIdToId: jest.fn(),
    };
    fileStorage = {
      getObjectMetadata: jest.fn(),
    };
    resumeRepository = {
      addResume: jest.fn(),
      updateResume: jest.fn(),
      deleteResume: jest.fn(),
      getResumeByPublicId: jest.fn(),
    };
    service = new ResumeService(
      userRepository as unknown as IUserRepository,
      fileStorage as unknown as IFileStorage,
      resumeRepository as unknown as IResumeRepository,
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
      resumeRepository.updateResume.mockResolvedValue(ok(undefined));

      const result = await service.updateResumeAsync(
        userPublicId,
        resumePublicId,
        {
          name: ' Updated Resume.pdf ',
          storageKey,
        },
      );

      expect(result.isOk()).toBe(true);
      expect(resumeRepository.updateResume).toHaveBeenCalledTimes(1);
      const updatedResume = resumeRepository.updateResume.mock.calls[0][0];
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
      expect(resumeRepository.updateResume).not.toHaveBeenCalled();
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
      expect(resumeRepository.updateResume).not.toHaveBeenCalled();
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
      expect(resumeRepository.updateResume).not.toHaveBeenCalled();
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
      resumeRepository.addResume.mockResolvedValue(ok(undefined));

      const result = await service.createResumeAsync(userPublicId, {
        name: ' Backend Resume.pdf ',
        storageKey,
      });

      expect(result.isOk()).toBe(true);
      expect(resumeRepository.addResume).toHaveBeenCalledTimes(1);

      const resume = resumeRepository.addResume.mock.calls[0][0];
      expect(resume.storagePath).toBe(storageKey);
      expect(resume.fileName).toBe('Backend Resume.pdf');
      expect(resume.fileSize).toBe(1024);
      expect(resume.fileType).toBe(CommonFileType.PDF);
      expect(resume.isActive).toBe(true);
      expect(resume.userId).toBe(42);
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
      expect(resumeRepository.addResume).not.toHaveBeenCalled();
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
      expect(resumeRepository.addResume).not.toHaveBeenCalled();
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
      expect(resumeRepository.addResume).not.toHaveBeenCalled();
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
      expect(resumeRepository.addResume).not.toHaveBeenCalled();
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
      resumeRepository.addResume.mockResolvedValue(
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
  });
});
