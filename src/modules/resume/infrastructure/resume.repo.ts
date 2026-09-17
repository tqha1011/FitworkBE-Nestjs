import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  IResumeRepository,
  ResumeStorageData,
} from '../domain/repositories/resume.repo.interface';
import { Resume } from '../domain/entities/resume.entity';
import { toCommonFileType, toPrismaFileType } from './resume.mapper';

@Injectable()
export class ResumeRepository implements IResumeRepository {
  constructor(private readonly prismaService: PrismaService) {}
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

  async updateResume(resume: Resume): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.resume.update({
        where: { id: resume.id },
        data: {
          storagePath: resume.storagePath,
          fileSize: resume.fileSize,
          fileType: toPrismaFileType(resume.fileType),
          fileName: resume.fileName,
          updatedAt: resume.updatedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to update resume. ${error}`));
    }
  }

  async addResume(resume: Resume): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.resume.create({
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
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to add resume. ${error}`));
    }
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
