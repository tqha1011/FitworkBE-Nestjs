import { FileType, ResumeIngestionStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ResumeQueryRepository } from './resume.query-repo';

jest.mock('src/shared/infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('ResumeQueryRepository', () => {
  const resume = {
    id: 10,
    publicId: 'resume-id',
    storagePath: 'user/owner-id/current/cv.pdf',
    fileName: 'Backend CV',
    fileType: FileType.PDF,
    fileSize: 512,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
  const metadata = {
    publicId: 'resume-id',
    fileName: 'Backend CV',
    fileType: 'pdf',
    fileSize: 512,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
  const select = {
    id: true,
    publicId: true,
    storagePath: true,
    fileName: true,
    fileType: true,
    fileSize: true,
    createdAt: true,
    updatedAt: true,
  };
  let prisma: {
    resume: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock };
    resumeContent: { findMany: jest.Mock };
  };
  let repository: ResumeQueryRepository;

  beforeEach(() => {
    prisma = {
      resume: {
        findMany: jest.fn().mockResolvedValue([resume]),
        findFirst: jest.fn().mockResolvedValue(resume),
        count: jest.fn().mockResolvedValue(41),
      },
      resumeContent: {
        findMany: jest.fn().mockResolvedValue([
          {
            resumeId: 10,
            publicId: 'current-content',
            status: ResumeIngestionStatus.PENDING,
          },
        ]),
      },
    };
    repository = new ResumeQueryRepository(prisma as unknown as PrismaService);
  });

  it('paginates only active resumes of the owner in deterministic order', async () => {
    const result = await repository.getResumesForOwner('owner-id', {
      pageNumber: 2,
      pageSize: 20,
    });

    expect(result._unsafeUnwrap()).toEqual({
      items: [
        {
          ...metadata,
          ingestionPublicId: 'current-content',
          ingestionStatus: 'PENDING',
        },
      ],
      totalPages: 3,
      pageNumber: 2,
      pageSize: 20,
      hasPrevious: true,
      hasNext: true,
    });
    expect(prisma.resume.findMany).toHaveBeenCalledWith({
      where: { isActive: true, user: { publicId: 'owner-id' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
      select,
    });
    expect(prisma.resume.count).toHaveBeenCalledWith({
      where: { isActive: true, user: { publicId: 'owner-id' } },
    });
  });

  it('loads current content for the whole page in one query', async () => {
    prisma.resume.findMany.mockResolvedValue([
      resume,
      {
        ...resume,
        id: 11,
        publicId: 'second-resume',
        storagePath: 'user/owner-id/second/cv.docx',
        fileType: FileType.DOCX,
      },
    ]);
    prisma.resumeContent.findMany.mockResolvedValue([
      {
        resumeId: 10,
        publicId: 'current-content',
        status: ResumeIngestionStatus.PROCESSING,
      },
      {
        resumeId: 11,
        publicId: 'second-content',
        status: ResumeIngestionStatus.COMPLETED,
      },
    ]);

    const result = await repository.getResumesForOwner('owner-id', {
      pageNumber: 1,
      pageSize: 20,
    });

    expect(
      result
        ._unsafeUnwrap()
        .items.map((item) => [
          item.publicId,
          item.fileType,
          item.ingestionPublicId,
          item.ingestionStatus,
        ]),
    ).toEqual([
      ['resume-id', 'pdf', 'current-content', 'PROCESSING'],
      ['second-resume', 'docx', 'second-content', 'COMPLETED'],
    ]);
    expect(prisma.resumeContent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.resumeContent.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { resumeId: 10, storagePath: 'user/owner-id/current/cv.pdf' },
          { resumeId: 11, storagePath: 'user/owner-id/second/cv.docx' },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      distinct: ['resumeId'],
      select: { resumeId: true, publicId: true, status: true },
    });
  });

  it.each([
    [0, 1, 0, false],
    [41, 4, 3, true],
  ])(
    'returns an empty page for count %s and page %s',
    async (count, pageNumber, totalPages, hasPrevious) => {
      prisma.resume.findMany.mockResolvedValue([]);
      prisma.resume.count.mockResolvedValue(count);

      expect(
        (
          await repository.getResumesForOwner('owner-id', {
            pageNumber,
            pageSize: 20,
          })
        )._unsafeUnwrap(),
      ).toEqual({
        items: [],
        totalPages,
        pageNumber,
        pageSize: 20,
        hasPrevious,
        hasNext: false,
      });
      expect(prisma.resumeContent.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(ResumeIngestionStatus))(
    'returns metadata when the current ingestion is %s',
    async (status) => {
      prisma.resumeContent.findMany.mockResolvedValue([
        { resumeId: 10, publicId: 'current-content', status },
      ]);

      expect(
        (
          await repository.getResumeDetailForOwner('owner-id', 'resume-id')
        )._unsafeUnwrap(),
      ).toEqual({
        ...metadata,
        ingestionPublicId: 'current-content',
        ingestionStatus: status,
      });
      expect(prisma.resume.findFirst).toHaveBeenCalledWith({
        where: {
          publicId: 'resume-id',
          isActive: true,
          user: { publicId: 'owner-id' },
        },
        select,
      });
    },
  );

  it('returns nullable ingestion fields instead of selecting content from an old file', async () => {
    prisma.resumeContent.findMany.mockResolvedValue([]);

    expect(
      (
        await repository.getResumeDetailForOwner('owner-id', 'resume-id')
      )._unsafeUnwrap(),
    ).toEqual({
      ...metadata,
      ingestionPublicId: null,
      ingestionStatus: null,
    });
    expect(prisma.resumeContent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ resumeId: 10, storagePath: 'user/owner-id/current/cv.pdf' }],
        },
      }),
    );
  });

  it('returns null for a missing, deleted or foreign resume without querying content', async () => {
    prisma.resume.findFirst.mockResolvedValue(null);

    expect(
      (
        await repository.getResumeDetailForOwner('owner-id', 'resume-id')
      )._unsafeUnwrap(),
    ).toBeNull();
    expect(prisma.resumeContent.findMany).not.toHaveBeenCalled();
  });

  it.each(['list', 'count', 'detail', 'content'] as const)(
    'preserves the cause and hides dependency details on %s failure',
    async (operation) => {
      const failure = new Error('private database error');
      if (operation === 'list')
        prisma.resume.findMany.mockRejectedValue(failure);
      if (operation === 'count') prisma.resume.count.mockRejectedValue(failure);
      if (operation === 'detail')
        prisma.resume.findFirst.mockRejectedValue(failure);
      if (operation === 'content')
        prisma.resumeContent.findMany.mockRejectedValue(failure);

      const result =
        operation === 'list' || operation === 'count'
          ? await repository.getResumesForOwner('owner-id', {
              pageNumber: 1,
              pageSize: 20,
            })
          : await repository.getResumeDetailForOwner('owner-id', 'resume-id');

      expect(result._unsafeUnwrapErr().cause).toBe(failure);
      expect(result._unsafeUnwrapErr().message).not.toContain(
        'private database error',
      );
    },
  );
});
