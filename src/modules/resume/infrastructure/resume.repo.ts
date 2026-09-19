import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  IResumeRepository,
  ResumeStorageData,
} from '../domain/repositories/resume.repo.interface';
import { Resume } from '../domain/entities/resume.entity';
import {
  ResumeContentSnapshot,
  ResumeIngestionReference,
} from '../domain/entities/resume-content.entity';
import {
  toCommonFileType,
  toCommonIngestionStatus,
  toPrismaFileType,
} from './resume.mapper';
import { ResumeIngestionStatus } from 'generated/prisma/enums';

@Injectable()
export class ResumeRepository implements IResumeRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async authorizeResume(
    resumePublicId: string,
    userPublicId: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: {
          publicId: resumePublicId,
          isActive: true,
          user: {
            publicId: userPublicId,
          },
        },
      });
      if (!resume) {
        return ok(false);
      }

      return ok(true);
    } catch (error) {
      return err(new Error(`Failed to authorize resume. ${error}`));
    }
  }
  async deleteResume(publicId: string): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.resume.updateMany({
        where: { publicId, isActive: true },
        data: {
          isActive: false,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to delete resume by public id. ${error}`));
    }
  }
  async getResumeByPublicId(
    publicId: string,
  ): Promise<Result<Resume | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: { publicId, isActive: true },
        select: {
          id: true,
          publicId: true,
          storagePath: true,
          fileSize: true,
          fileType: true,
          fileName: true,
          isActive: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!resume) {
        return ok(null);
      }

      return ok(
        Resume.restore({
          ...resume,
          fileType: toCommonFileType(resume.fileType),
        }),
      );
    } catch (error) {
      return err(new Error(`Failed to get resume by public id. ${error}`));
    }
  }

  async updateResumeWithPendingContent(
    resume: Resume,
    snapshot: ResumeContentSnapshot,
  ): Promise<Result<ResumeIngestionReference, Error>> {
    try {
      const ingestion = await this.prismaService.$transaction(async (tx) => {
        await tx.resume.update({
          where: { id: resume.id },
          data: {
            storagePath: resume.storagePath,
            fileSize: resume.fileSize,
            fileType: toPrismaFileType(resume.fileType),
            fileName: resume.fileName,
            updatedAt: resume.updatedAt,
          },
        });

        const existing = await tx.resumeContent.findUnique({
          where: {
            resumeId_storagePath_parserVersion: {
              resumeId: resume.id,
              storagePath: snapshot.storagePath,
              parserVersion: snapshot.parserVersion,
            },
          },
          select: { publicId: true, status: true },
        });

        if (!existing) {
          return tx.resumeContent.create({
            data: this.pendingContentData(resume.id, snapshot),
            select: { publicId: true, status: true },
          });
        }

        if (existing.status === ResumeIngestionStatus.FAILED) {
          return tx.resumeContent.update({
            where: { publicId: existing.publicId },
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
        }

        return existing;
      });

      return ok({
        publicId: resume.publicId,
        ingestionPublicId: ingestion.publicId,
        ingestionStatus: toCommonIngestionStatus(ingestion.status),
      });
    } catch (error) {
      return err(new Error(`Failed to update resume with content. ${error}`));
    }
  }

  async addResumeWithPendingContent(
    resume: Resume,
    snapshot: ResumeContentSnapshot,
  ): Promise<Result<ResumeIngestionReference, Error>> {
    try {
      const ingestion = await this.prismaService.$transaction(async (tx) => {
        const createdResume = await tx.resume.create({
          data: {
            publicId: resume.publicId,
            storagePath: resume.storagePath,
            fileSize: resume.fileSize,
            fileType: toPrismaFileType(resume.fileType),
            fileName: resume.fileName,
            isActive: resume.isActive,
            userId: resume.userId,
            createdAt: resume.createdAt,
            updatedAt: resume.updatedAt,
          },
          select: { id: true },
        });

        return tx.resumeContent.create({
          data: this.pendingContentData(createdResume.id, snapshot),
          select: { publicId: true, status: true },
        });
      });

      return ok({
        publicId: resume.publicId,
        ingestionPublicId: ingestion.publicId,
        ingestionStatus: toCommonIngestionStatus(ingestion.status),
      });
    } catch (error) {
      return err(new Error(`Failed to add resume with content. ${error}`));
    }
  }

  private pendingContentData(
    resumeId: number,
    snapshot: ResumeContentSnapshot,
  ) {
    return {
      resumeId,
      storagePath: snapshot.storagePath,
      fileSize: snapshot.fileSize,
      fileType: toPrismaFileType(snapshot.fileType),
      fileName: snapshot.fileName,
      parserVersion: snapshot.parserVersion,
      status: ResumeIngestionStatus.PENDING,
    };
  }

  async getResumeStorageData(
    publicId: string,
  ): Promise<Result<ResumeStorageData | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: { publicId, isActive: true },
        select: {
          id: true,
          storagePath: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          user: {
            select: {
              publicId: true,
            },
          },
        },
      });
      if (!resume) {
        return ok(null);
      }
      return ok({
        resumeId: resume.id,
        ownerPublicId: resume.user.publicId,
        storageKey: resume.storagePath,
        fileName: resume.fileName,
        fileType: resume.fileType,
        fileSize: resume.fileSize,
      });
    } catch (error) {
      return err(new Error(`Failed to get resume storage data. ${error}`));
    }
  }

  async resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findFirst({
        where: { publicId, isActive: true },
        select: {
          id: true,
        },
      });
      if (!resume) {
        return ok(null);
      }
      return ok(resume.id);
    } catch (error) {
      return err(new Error(`Failed to resolve public id to id. ${error}`));
    }
  }
}
