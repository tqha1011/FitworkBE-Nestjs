import { err, Result } from 'neverthrow';
import { IJobRepository } from '../domain/repositories/job.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { ok } from 'neverthrow';
import { Job } from '../domain/entities/job.entity';
import {
  IJobQueryRepository,
  JobListFilter,
} from '../application/interfaces/job.query-repo.interface';
import { PageResult } from 'src/shared/common/pagination';
import {
  JobDetailResponseDto,
  JobItemResponseDto,
} from '../application/dtos/job.response.dto';
import { JobApplicantStatus, JobStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import {
  mapCurrencyToDomain,
  mapCurrencyToPrisma,
  mapStatusToDomain,
  mapStatusToPrisma,
} from './job.mapper';

export class JobRepository implements IJobRepository, IJobQueryRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async getJobDetails(
    jobPublicId: string,
  ): Promise<Result<JobDetailResponseDto | null, Error>> {
    try {
      const job = await this.prismaService.job.findUnique({
        where: {
          publicId: jobPublicId,
        },
        select: {
          publicId: true,
          title: true,
          description: true,
          requirements: true,
          location: true,
          budget: true,
          currency: true,
          status: true,
          dueAt: true,
          user: {
            select: {
              companyProfile: {
                select: {
                  publicId: true,
                  companyName: true,
                  createdAt: true,
                },
              },
            },
          },
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
      });
      if (!job) return ok(null);
      if (!job.user.companyProfile) {
        return err(new Error('Job poster company profile not found'));
      }
      const jobDetailResponse: JobDetailResponseDto = {
        publicId: job.publicId,
        title: job.title,
        description: job.description,
        location: job.location,
        requirements: job.requirements,
        budget: job.budget.toNumber(),
        currency: mapCurrencyToDomain(job.currency),
        status: mapStatusToDomain(job.status),
        skills: job.jobSkills.map((jobSkill) => jobSkill.skill),
        category: job.category,
        arrangement: job.arrangement,
        postedBy: {
          publicId: job.user.companyProfile.publicId,
          name: job.user.companyProfile.companyName,
          participatedSince: job.user.companyProfile.createdAt,
        },
        dueAt: job.dueAt,
        totalApplicants: job._count.jobApplicants,
      };
      return ok(jobDetailResponse);
    } catch (error) {
      return err(new Error(`Failed to get job details ${error}`));
    }
  }
  async getListJobs(
    pageNumber: number,
    pageSize: number,
    filter?: JobListFilter,
  ): Promise<Result<PageResult<JobItemResponseDto>, Error>> {
    try {
      const where: Prisma.JobWhereInput = {
        status: JobStatus.OPEN,
        ...(filter?.title && {
          title: { contains: filter.title, mode: 'insensitive' },
        }),
        ...(filter?.categoryIds?.length && {
          categoryId: { in: filter.categoryIds },
        }),
        ...(filter?.skillIds?.length && {
          jobSkills: { some: { skillId: { in: filter.skillIds } } },
        }),
        ...((filter?.budgetMin !== undefined ||
          filter?.budgetMax !== undefined) && {
          // budgetMin/budgetMax are expressed in the base currency (VND) so
          // filtering works consistently across jobs posted in different currencies.
          budgetInBaseCurrency: {
            ...(filter?.budgetMin !== undefined && { gte: filter.budgetMin }),
            ...(filter?.budgetMax !== undefined && { lte: filter.budgetMax }),
          },
        }),
      };
      const [jobs, totalItems] = await Promise.all([
        this.prismaService.job.findMany({
          where,
          select: {
            publicId: true,
            title: true,
            description: true,
            location: true,
            budget: true,
            currency: true,
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
        this.prismaService.job.count({ where }),
      ]);
      const jobItemListResponse: JobItemResponseDto[] = jobs.map((job) => ({
        publicId: job.publicId,
        title: job.title,
        description: job.description,
        location: job.location,
        budget: job.budget.toNumber(),
        currency: mapCurrencyToDomain(job.currency),
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
          publicId: job.publicId,
          title: job.title,
          description: job.description,
          requirements: job.requirements,
          location: job.location,
          status: mapStatusToPrisma(job.status),
          dueAt: job.dueAt,
          budget: job.budget,
          currency: mapCurrencyToPrisma(job.currency),
          budgetInBaseCurrency: job.budgetInBaseCurrency,
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
