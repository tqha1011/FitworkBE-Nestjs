import { Injectable } from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { err, ok, Result } from 'neverthrow';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ResumeReadResponseDto } from '../application/dtos/resume.response.dto';
import { IResumeQueryRepository } from '../application/interfaces/resume.query-repo.interface';
import { toCommonFileType, toCommonIngestionStatus } from './resume.mapper';

const resumeReadSelect = {
  id: true,
  publicId: true,
  storagePath: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ResumeReadRecord = Prisma.ResumeGetPayload<{
  select: typeof resumeReadSelect;
}>;

@Injectable()
export class ResumeQueryRepository implements IResumeQueryRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async getResumesForOwner(
    ownerPublicId: string,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<ResumeReadResponseDto>, Error>> {
    try {
      const { pageNumber, pageSize } = pagination;
      const where = { isActive: true, user: { publicId: ownerPublicId } };
      const [resumes, totalItems] = await Promise.all([
        this.prismaService.resume.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (pageNumber - 1) * pageSize,
          take: pageSize,
          select: resumeReadSelect,
        }),
        this.prismaService.resume.count({ where }),
      ]);
      const items = await this.withCurrentIngestion(resumes);
      return ok(new PageResult(items, totalItems, pageNumber, pageSize));
    } catch (error) {
      return err(
        new Error('Failed to get resumes for owner', { cause: error }),
      );
    }
  }

  async getResumeDetailForOwner(
    ownerPublicId: string,
    resumePublicId: string,
  ): Promise<Result<ResumeReadResponseDto | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: {
          publicId: resumePublicId,
          isActive: true,
          user: { publicId: ownerPublicId },
        },
        select: resumeReadSelect,
      });
      if (!resume) return ok(null);

      const [detail] = await this.withCurrentIngestion([resume]);
      return ok(detail);
    } catch (error) {
      return err(new Error('Failed to get resume for owner', { cause: error }));
    }
  }

  private async withCurrentIngestion(
    resumes: ResumeReadRecord[],
  ): Promise<ResumeReadResponseDto[]> {
    if (resumes.length === 0) return [];

    const contents = await this.prismaService.resumeContent.findMany({
      where: {
        OR: resumes.map((resume) => ({
          resumeId: resume.id,
          storagePath: resume.storagePath,
        })),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      distinct: ['resumeId'],
      select: { resumeId: true, publicId: true, status: true },
    });
    const contentByResumeId = new Map(
      contents.map((content) => [content.resumeId, content]),
    );

    return resumes.map((resume) => {
      const content = contentByResumeId.get(resume.id);
      return {
        publicId: resume.publicId,
        fileName: resume.fileName,
        fileType: toCommonFileType(resume.fileType),
        fileSize: resume.fileSize,
        createdAt: resume.createdAt,
        updatedAt: resume.updatedAt,
        ingestionPublicId: content?.publicId ?? null,
        ingestionStatus: content
          ? toCommonIngestionStatus(content.status)
          : null,
      };
    });
  }
}
