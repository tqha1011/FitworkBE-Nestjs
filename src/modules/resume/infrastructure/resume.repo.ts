import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { IResumeRepository } from '../domain/repositories/resume.repo.interface';

@Injectable()
export class ResumeRepository implements IResumeRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>> {
    try {
      const resume = await this.prismaService.resume.findUnique({
        where: { publicId },
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
