import { Injectable } from '@nestjs/common';
import { ResumeIngestionStatus } from 'generated/prisma/enums';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ResumeContentRecord } from '../domain/entities/resume-content.entity';
import {
  CompleteResumeContentInput,
  IResumeContentRepository,
} from '../domain/repositories/resume-content.repo.interface';
import { toCommonFileType, toCommonIngestionStatus } from './resume.mapper';

const resumeContentSelect = {
  id: true,
  publicId: true,
  resumeId: true,
  status: true,
  errorMessage: true,
  storagePath: true,
  fileSize: true,
  fileType: true,
  fileName: true,
  extractedText: true,
  contentHash: true,
  parserVersion: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  resume: {
    select: {
      publicId: true,
      user: { select: { publicId: true } },
    },
  },
} as const;

@Injectable()
export class ResumeContentRepository implements IResumeContentRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async getByPublicId(
    publicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    try {
      const content = await this.prismaService.resumeContent.findUnique({
        where: { publicId },
        select: resumeContentSelect,
      });
      return ok(content ? this.toRecord(content) : null);
    } catch (error) {
      return err(new Error(`Failed to get resume content. ${error}`));
    }
  }

  async getCurrentForOwner(
    resumePublicId: string,
    ownerPublicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: {
          publicId: resumePublicId,
          isActive: true,
          user: { publicId: ownerPublicId },
        },
        select: { id: true, storagePath: true },
      });
      if (!resume) {
        return ok(null);
      }

      const content = await this.prismaService.resumeContent.findFirst({
        where: {
          resumeId: resume.id,
          storagePath: resume.storagePath,
        },
        orderBy: { updatedAt: 'desc' },
        select: resumeContentSelect,
      });
      return ok(content ? this.toRecord(content) : null);
    } catch (error) {
      return err(new Error(`Failed to get current resume content. ${error}`));
    }
  }

  async markProcessing(
    publicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    return this.updateMutable(publicId, {
      status: ResumeIngestionStatus.PROCESSING,
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
    });
  }

  async markCompleted(
    input: CompleteResumeContentInput,
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    return this.updateMutable(input.publicId, {
      status: ResumeIngestionStatus.COMPLETED,
      errorMessage: null,
      extractedText: input.extractedText,
      contentHash: input.contentHash,
      completedAt: new Date(),
    });
  }

  async markFailed(
    publicId: string,
    errorMessage: string,
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    return this.updateMutable(publicId, {
      status: ResumeIngestionStatus.FAILED,
      errorMessage,
      completedAt: new Date(),
    });
  }

  private async updateMutable(
    publicId: string,
    data: Parameters<PrismaService['resumeContent']['updateMany']>[0]['data'],
  ): Promise<Result<ResumeContentRecord | null, Error>> {
    try {
      const content = await this.prismaService.$transaction(async (tx) => {
        await tx.resumeContent.updateMany({
          where: {
            publicId,
            status: { not: ResumeIngestionStatus.COMPLETED },
          },
          data,
        });
        return tx.resumeContent.findUnique({
          where: { publicId },
          select: resumeContentSelect,
        });
      });
      return ok(content ? this.toRecord(content) : null);
    } catch (error) {
      return err(new Error(`Failed to update resume content. ${error}`));
    }
  }

  private toRecord(content: {
    id: number;
    publicId: string;
    resumeId: number;
    status: ResumeIngestionStatus;
    errorMessage: string | null;
    storagePath: string;
    fileSize: number;
    fileType: Parameters<typeof toCommonFileType>[0];
    fileName: string;
    extractedText: string | null;
    contentHash: string | null;
    parserVersion: string;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    resume: { publicId: string; user: { publicId: string } };
  }): ResumeContentRecord {
    return {
      id: content.id,
      publicId: content.publicId,
      resumeId: content.resumeId,
      resumePublicId: content.resume.publicId,
      ownerPublicId: content.resume.user.publicId,
      status: toCommonIngestionStatus(content.status),
      errorMessage: content.errorMessage,
      storagePath: content.storagePath,
      fileSize: content.fileSize,
      fileType: toCommonFileType(content.fileType),
      fileName: content.fileName,
      extractedText: content.extractedText,
      contentHash: content.contentHash,
      parserVersion: content.parserVersion,
      startedAt: content.startedAt,
      completedAt: content.completedAt,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    };
  }
}
