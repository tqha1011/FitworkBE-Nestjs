import { createHash } from 'crypto';
import { err, ok } from 'neverthrow';
import {
  CommonFileType,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { ResumeContentRecord } from '../../domain/entities/resume-content.entity';
import { IResumeContentRepository } from '../../domain/repositories/resume-content.repo.interface';
import { IResumeTextExtractor } from '../interfaces/resume-text-extractor.interface';
import { ResumeIngestionService } from './resume-ingestion.service';

describe('ResumeIngestionService', () => {
  const payload = {
    resumePublicId: 'resume-id',
    resumeContentPublicId: 'content-id',
  };
  const now = new Date('2026-01-01T00:00:00.000Z');

  const record = (
    overrides: Partial<ResumeContentRecord> = {},
  ): ResumeContentRecord => ({
    id: 1,
    publicId: payload.resumeContentPublicId,
    resumeId: 2,
    resumePublicId: payload.resumePublicId,
    ownerPublicId: 'owner-id',
    status: CommonResumeIngestionStatus.PENDING,
    errorMessage: null,
    storagePath: 'user/owner/file/cv.pdf',
    fileSize: 4,
    fileType: CommonFileType.PDF,
    fileName: 'Resume.pdf',
    parserVersion: 'pdf-parse@2.4.5/text-v1',
    extractedText: null,
    contentHash: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  let contentRepository: {
    getByPublicId: jest.Mock;
    markProcessing: jest.Mock;
    markCompleted: jest.Mock;
    markFailed: jest.Mock;
  };
  let fileStorage: { getObject: jest.Mock };
  let textExtractor: { extract: jest.Mock };
  let notifier: { notify: jest.Mock };
  let service: ResumeIngestionService;

  beforeEach(() => {
    contentRepository = {
      getByPublicId: jest.fn(),
      markProcessing: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };
    fileStorage = { getObject: jest.fn() };
    textExtractor = { extract: jest.fn() };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ResumeIngestionService(
      contentRepository as unknown as IResumeContentRepository,
      fileStorage as unknown as IFileStorage,
      textExtractor as unknown as IResumeTextExtractor,
      notifier,
    );
  });

  it.each([CommonFileType.PDF, CommonFileType.DOCX])(
    'extracts %s, normalizes text, hashes source bytes and completes',
    async (fileType) => {
      const buffer = Buffer.from('data');
      const pending = record({ fileType });
      const processing = record({
        fileType,
        status: CommonResumeIngestionStatus.PROCESSING,
      });
      const completed = record({
        fileType,
        status: CommonResumeIngestionStatus.COMPLETED,
      });
      contentRepository.getByPublicId.mockResolvedValue(ok(pending));
      contentRepository.markProcessing.mockResolvedValue(ok(processing));
      fileStorage.getObject.mockResolvedValue(ok(buffer));
      textExtractor.extract.mockResolvedValue(ok(' First\r\nSecond\0 '));
      contentRepository.markCompleted.mockResolvedValue(ok(completed));

      await service.ingest(payload, 0, 3);

      expect(textExtractor.extract).toHaveBeenCalledWith(fileType, buffer);
      expect(contentRepository.markCompleted).toHaveBeenCalledWith({
        publicId: payload.resumeContentPublicId,
        extractedText: 'First\nSecond',
        contentHash: createHash('sha256').update(buffer).digest('hex'),
      });
      expect(notifier.notify).toHaveBeenCalledTimes(2);
      expect(notifier.notify).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: CommonResumeIngestionStatus.COMPLETED,
        }),
      );
    },
  );

  it('skips an already completed ingestion job', async () => {
    contentRepository.getByPublicId.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.COMPLETED })),
    );

    await service.ingest(payload, 0, 3);

    expect(contentRepository.markProcessing).not.toHaveBeenCalled();
    expect(fileStorage.getObject).not.toHaveBeenCalled();
  });

  it('throws an R2 failure without marking failed before the final attempt', async () => {
    contentRepository.getByPublicId.mockResolvedValue(ok(record()));
    contentRepository.markProcessing.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.PROCESSING })),
    );
    fileStorage.getObject.mockResolvedValue(err(new Error('R2 unavailable')));

    await expect(service.ingest(payload, 0, 3)).rejects.toThrow(
      'R2 unavailable',
    );
    expect(contentRepository.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed after empty extracted text on the final attempt', async () => {
    const failed = record({
      status: CommonResumeIngestionStatus.FAILED,
      errorMessage: 'Resume text is empty after extraction',
    });
    contentRepository.getByPublicId.mockResolvedValue(ok(record()));
    contentRepository.markProcessing.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.PROCESSING })),
    );
    fileStorage.getObject.mockResolvedValue(ok(Buffer.from('data')));
    textExtractor.extract.mockResolvedValue(ok('\r\n\0  '));
    contentRepository.markFailed.mockResolvedValue(ok(failed));

    await expect(service.ingest(payload, 2, 3)).rejects.toThrow(
      'Resume text is empty after extraction',
    );
    expect(contentRepository.markFailed).toHaveBeenCalledWith(
      payload.resumeContentPublicId,
      'Resume text is empty after extraction',
    );
    expect(notifier.notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: CommonResumeIngestionStatus.FAILED }),
    );
  });

  it('marks failed when parsing fails on the final attempt', async () => {
    contentRepository.getByPublicId.mockResolvedValue(ok(record()));
    contentRepository.markProcessing.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.PROCESSING })),
    );
    fileStorage.getObject.mockResolvedValue(ok(Buffer.from('data')));
    textExtractor.extract.mockResolvedValue(err(new Error('parser failed')));
    contentRepository.markFailed.mockResolvedValue(
      ok(
        record({
          status: CommonResumeIngestionStatus.FAILED,
          errorMessage: 'parser failed',
        }),
      ),
    );

    await expect(service.ingest(payload, 2, 3)).rejects.toThrow(
      'parser failed',
    );
    expect(contentRepository.markFailed).toHaveBeenCalled();
  });

  it('rejects a buffer whose size differs from the snapshot', async () => {
    contentRepository.getByPublicId.mockResolvedValue(ok(record()));
    contentRepository.markProcessing.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.PROCESSING })),
    );
    fileStorage.getObject.mockResolvedValue(ok(Buffer.from('wrong-size')));
    contentRepository.markFailed.mockResolvedValue(
      ok(record({ status: CommonResumeIngestionStatus.FAILED })),
    );

    await expect(service.ingest(payload, 2, 3)).rejects.toThrow(
      'Resume file size mismatch',
    );
    expect(textExtractor.extract).not.toHaveBeenCalled();
  });
});
