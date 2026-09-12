import { err, Result } from 'neverthrow';
import { IJobRepository } from '../domain/repositories/job.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ok } from 'neverthrow';
import { Job } from '../domain/entities/job.entity';
import { IJobQueryRepository } from '../application/interfaces/job.query-repo.interface';
import { PageResult } from 'src/shared/common/pagination';
import { JobItemResponseDto } from '../application/dtos/job.response.dto';
import { JobApplicantStatus, JobStatus } from 'generated/prisma/enums';

export class JobRepository implements IJobRepository, IJobQueryRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async getListJobs(
    pageNumber: number,
    pageSize: number,
  ): Promise<Result<PageResult<JobItemResponseDto>, Error>> {
    try {
      const [jobs, totalItems] = await Promise.all([
        this.prismaService.job.findMany({
          where: {
            status: JobStatus.OPEN,
          },
          select: {
            publicId: true,
            title: true,
            description: true,
            location: true,
            budget: true,
            dueAt: true,
            _count: {
              select: {
                jobApplicants: {
                  where: {
                    status: {
                      in: [
                        JobApplicantStatus.PENDING,
                        JobApplicantStatus.ACCEPTED,
                      ],
                    },
                  },
                },
              },
            },
            jobSkills: {
              select: {
                skill: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            arrangement: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { dueAt: 'desc' }],
          take: pageSize,
          skip: (pageNumber - 1) * pageSize,
        }),
        this.prismaService.job.count({
          where: {
            status: JobStatus.OPEN,
          },
        }),
      ]);
      const jobItemListResponse: JobItemResponseDto[] = jobs.map((job) => ({
        publicId: job.publicId,
        title: job.title,
        description: job.description,
        location: job.location,
        budget: job.budget.toNumber(),
        skills: job.jobSkills.map((jobSkill) => jobSkill.skill),
        category: job.category,
        arrangement: job.arrangement,
        dueAt: job.dueAt,
        totalApplicants: job._count.jobApplicants,
      }));
      return ok(
        new PageResult<JobItemResponseDto>(
          jobItemListResponse,
          totalItems,
          pageNumber,
          pageSize,
        ),
      );
    } catch (error) {
      return err(new Error(`Failed to get list jobs ${error}`));
    }
  }

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
