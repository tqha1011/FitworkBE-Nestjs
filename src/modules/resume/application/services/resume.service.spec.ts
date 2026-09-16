import { err, ok } from 'neverthrow';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { MAX_RESUME_FILE_SIZE } from '../../domain/entities/resume.entity';
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
    };
    service = new ResumeService(
      userRepository as unknown as IUserRepository,
      fileStorage as unknown as IFileStorage,
      resumeRepository as unknown as IResumeRepository,
    );
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
