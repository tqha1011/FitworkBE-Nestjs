import { err, Result } from 'neverthrow';
import { IJobRepository } from '../domain/repositories/job.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ok } from 'neverthrow';
import { Job } from '../domain/entities/job.entity';

export class JobRepository implements IJobRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async addJob(job: Job): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.job.create({
        data: {
          id: job.id,
          publicId: job.publicId,
          title: job.title,
          description: job.description,
          requirements: job.requirements,
          location: job.location,
          status: job.status,
          dueAt: job.dueAt,
          budget: job.budget,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          postedBy: job.postedBy,
          arrangementId: job.arrangementId,
          categoryId: job.categoryId,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to add job ${error}`));
    }
  }

  async getJobIdByPublicId(publicId: string): Promise<Result<number, Error>> {
    try {
      const job = await this.prismaService.job.findUnique({
        where: { publicId },
      });
      if (!job) {
        return err(new Error('Job not found'));
      }
      return ok(job.id);
    } catch (error) {
      return err(new Error(`Failed to get job by publicId ${error}`));
    }
  }
}
