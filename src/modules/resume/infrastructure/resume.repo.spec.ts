import { FileType, ResumeIngestionStatus } from 'generated/prisma/enums';
import { CommonFileType } from 'src/shared/domain/enum';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { Resume } from '../domain/entities/resume.entity';
import { ResumeRepository } from './resume.repo';

jest.mock('src/shared/infrastructure/database/prisma.service', () => ({
  PrismaService: class {},
}));

describe('ResumeRepository ingestion persistence', () => {
  const resume = Resume.restore({
    id: 10,
    publicId: 'resume-id',
    storagePath: 'user/owner/upload/cv.pdf',
    fileSize: 100,
    fileType: CommonFileType.PDF,
    fileName: 'Resume.pdf',
    isActive: true,
    userId: 20,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  const snapshot = {
    storagePath: resume.storagePath,
    fileSize: resume.fileSize,
    fileType: resume.fileType,
    fileName: resume.fileName,
    parserVersion: 'pdf-parse@2.4.5/text-v1',
  };

  const setup = () => {
    const tx = {
      resume: {
        create: jest.fn(),
        update: jest.fn(),
      },
      resumeContent: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    return {
      tx,
      prisma,
      repository: new ResumeRepository(prisma as unknown as PrismaService),
    };
  };

  it('creates the resume and pending content in one transaction', async () => {
    const { tx, prisma, repository } = setup();
    tx.resume.create.mockResolvedValue({ id: 10 });
    tx.resumeContent.create.mockResolvedValue({
      publicId: 'content-id',
      status: ResumeIngestionStatus.PENDING,
    });

    const result = await repository.addResumeWithPendingContent(
      resume,
      snapshot,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.resume.create).toHaveBeenCalled();
    expect(tx.resumeContent.create).toHaveBeenCalledWith({
      data: {
        resumeId: 10,
        storagePath: snapshot.storagePath,
        fileSize: snapshot.fileSize,
        fileType: FileType.PDF,
        fileName: snapshot.fileName,
        parserVersion: snapshot.parserVersion,
        status: ResumeIngestionStatus.PENDING,
      },
      select: { publicId: true, status: true },
    });
    expect(result.isOk() && result.value.ingestionPublicId).toBe('content-id');
  });

  it('reuses and resets a failed version with the same storage key', async () => {
    const { tx, repository } = setup();
    tx.resume.update.mockResolvedValue({});
    tx.resumeContent.findUnique.mockResolvedValue({
      publicId: 'content-id',
      status: ResumeIngestionStatus.FAILED,
    });
    tx.resumeContent.update.mockResolvedValue({
      publicId: 'content-id',
      status: ResumeIngestionStatus.PENDING,
    });

    const result = await repository.updateResumeWithPendingContent(
      resume,
      snapshot,
    );

    expect(tx.resumeContent.create).not.toHaveBeenCalled();
    expect(tx.resumeContent.update).toHaveBeenCalledWith({
      where: { publicId: 'content-id' },
      data: {
        status: ResumeIngestionStatus.PENDING,
        errorMessage: null,
        extractedText: null,
        contentHash: null,
        startedAt: null,
        completedAt: null,
      },
      select: { publicId: true, status: true },
    });
    expect(result.isOk() && result.value.ingestionPublicId).toBe('content-id');
  });

  it('does not create a duplicate pending version', async () => {
    const { tx, repository } = setup();
    tx.resume.update.mockResolvedValue({});
    tx.resumeContent.findUnique.mockResolvedValue({
      publicId: 'content-id',
      status: ResumeIngestionStatus.PENDING,
    });

    const result = await repository.updateResumeWithPendingContent(
      resume,
      snapshot,
    );

    expect(tx.resumeContent.create).not.toHaveBeenCalled();
    expect(tx.resumeContent.update).not.toHaveBeenCalled();
    expect(result.isOk()).toBe(true);
  });
});

describe('ResumeRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: ResumeRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    [
      'authorizeResume',
      (repository) => repository.authorizeResume('user', 'resume'),
    ],
    ['deleteResume', (repository) => repository.deleteResume('resume')],
    [
      'getResumeByPublicId',
      (repository) => repository.getResumeByPublicId('resume'),
    ],
    [
      'updateResumeWithPendingContent',
      (repository) =>
        repository.updateResumeWithPendingContent({} as never, {} as never),
    ],
    [
      'addResumeWithPendingContent',
      (repository) =>
        repository.addResumeWithPendingContent({} as never, {} as never),
    ],
    [
      'getResumeStorageData',
      (repository) => repository.getResumeStorageData('resume'),
    ],
    [
      'resolvePublicIdToId',
      (repository) => repository.resolvePublicIdToId('resume'),
    ],
  ];

  describe.each([
    ['Error', new Error('private dependency payload')],
    ['non-Error', { message: 'private dependency payload', code: 'PRIVATE' }],
  ])('%s failures', (_kind, failure) => {
    it.each(operations)(
      'preserves the cause and hides dependency details in %s',
      async (_method, invoke) => {
        const delegate = {
          findUnique: jest.fn().mockRejectedValue(failure),
          findFirst: jest.fn().mockRejectedValue(failure),
          findMany: jest.fn().mockRejectedValue(failure),
          count: jest.fn().mockRejectedValue(failure),
          create: jest.fn().mockRejectedValue(failure),
          update: jest.fn().mockRejectedValue(failure),
          updateMany: jest.fn().mockRejectedValue(failure),
        };
        const repository = new ResumeRepository({
          resume: delegate,
          $transaction: jest.fn().mockRejectedValue(failure),
        } as unknown as PrismaService);
        const error = (await invoke(repository))._unsafeUnwrapErr();
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain('private dependency payload');
        expect(error.message).not.toContain('[object Object]');
      },
    );
  });
});
