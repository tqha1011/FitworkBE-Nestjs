import { err, ok, Result } from 'neverthrow';
import { Prisma } from 'generated/prisma/client';
import { IJobApplicantQueryRepo } from '../application/interfaces/job-applicant.query-repo.interface';
import { JobApplicantItemResponseDto } from '../application/dtos/job.response.dto';
import {
  IJobApplicantRepository,
  JobApplicantStatusContext,
} from '../domain/repositories/job-applicant.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { JobApplicant } from '../domain/entities/job-applicant.entity';
import { PageResult } from 'src/shared/common/pagination';
import {
  mapJobApplicantStatusToDomain,
  mapJobApplicantStatusToPrisma,
} from './job-applicant.mapper';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';

const optimisticLockConflict = new Error('Optimistic lock conflict');

export class JobApplicantRepository
  implements IJobApplicantRepository, IJobApplicantQueryRepo
{
  constructor(private readonly prismaService: PrismaService) {}
  async acceptApplicantAndRejectOthers(
    jobApplicantPublicId: string,
    jobId: number,
    expectedStatus: CommonJobApplicantStatus,
    expectedVersion: number,
  ): Promise<Result<boolean, Error>> {
    try {
      const transitioned = await this.prismaService.$transaction(
        async (transaction) => {
          const claimedJob = await transaction.job.updateMany({
            where: {
              id: jobId,
              version: expectedVersion,
            },
            data: {
              version: { increment: 1 },
            },
          });

          if (claimedJob.count !== 1) return false;

          const acceptedApplicant = await transaction.jobApplicant.updateMany({
            where: {
              publicId: jobApplicantPublicId,
              jobId,
              status: mapJobApplicantStatusToPrisma(expectedStatus),
            },
            data: {
              status: mapJobApplicantStatusToPrisma(
                CommonJobApplicantStatus.ACCEPTED,
              ),
            },
          });

          if (acceptedApplicant.count !== 1) throw optimisticLockConflict;

          await transaction.jobApplicant.updateMany({
            where: {
              publicId: { not: jobApplicantPublicId },
              jobId,
              status: mapJobApplicantStatusToPrisma(expectedStatus),
            },
            data: {
              status: mapJobApplicantStatusToPrisma(
                CommonJobApplicantStatus.REJECTED,
              ),
            },
          });

          return true;
        },
      );

      return ok(transitioned);
    } catch (error) {
      if (error === optimisticLockConflict) return ok(false);
      return err(
        new Error(`Failed to accept applicant and reject others: ${error}`),
      );
    }
  }
  async rejectAllApplicants(jobId: number): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.jobApplicant.updateMany({
        where: { jobId },
        data: {
          status: mapJobApplicantStatusToPrisma(
            CommonJobApplicantStatus.REJECTED,
          ),
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(error);
    }
  }

  async getStatusContext(
    jobApplicantPublicId: string,
  ): Promise<Result<JobApplicantStatusContext | null, Error>> {
    try {
      const jobApplicant = await this.prismaService.jobApplicant.findUnique({
        where: { publicId: jobApplicantPublicId },
        select: {
          jobId: true,
          status: true,
          job: { select: { postedBy: true, version: true } },
        },
      });

      if (!jobApplicant) return ok(null);
      return ok({
        jobId: jobApplicant.jobId,
        jobOwnerId: jobApplicant.job.postedBy,
        status: mapJobApplicantStatusToDomain(jobApplicant.status),
        version: jobApplicant.job.version,
      });
    } catch (error) {
      return err(
        new Error(`Failed to get job applicant status context: ${error}`),
      );
    }
  }

  async transitionStatus(
    jobApplicantPublicId: string,
    jobId: number,
    expectedStatus: CommonJobApplicantStatus,
    nextStatus: CommonJobApplicantStatus,
  ): Promise<Result<boolean, Error>> {
    try {
      const result = await this.prismaService.jobApplicant.updateMany({
        where: {
          publicId: jobApplicantPublicId,
          jobId,
          status: mapJobApplicantStatusToPrisma(expectedStatus),
        },
        data: { status: mapJobApplicantStatusToPrisma(nextStatus) },
      });

      return ok(result.count === 1);
    } catch (error) {
      return err(
        new Error(`Failed to transition job applicant status: ${error}`),
      );
    }
  }

  async getJobsAppliedAsync(
    userId: number,
    pageNumber: number,
    pageSize: number,
  ): Promise<Result<PageResult<JobApplicantItemResponseDto>, Error>> {
    try {
      const where: Prisma.JobApplicantWhereInput = { applicantId: userId };
      const [applications, totalItems] = await Promise.all([
        this.prismaService.jobApplicant.findMany({
          where,
          select: {
            publicId: true,
            status: true,
            proposedRate: true,
            estimatedDay: true,
            appliedAt: true,
            job: { select: { publicId: true } },
            resume: { select: { publicId: true } },
            evaluations: {
              where: { overallScore: { not: null } },
              select: { overallScore: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
          take: pageSize,
          skip: (pageNumber - 1) * pageSize,
        }),
        this.prismaService.jobApplicant.count({ where }),
      ]);

      const items: JobApplicantItemResponseDto[] = applications.map(
        (application) => ({
          jobApplicantPublicId: application.publicId,
          jobPublicId: application.job.publicId,
          status: mapJobApplicantStatusToDomain(application.status),
          resumePublicId: application.resume.publicId,
          proposedRate: application.proposedRate.toNumber(),
          estimatedDays: application.estimatedDay,
          appliedAt: application.appliedAt,
          matchingScore: application.evaluations[0]?.overallScore ?? 0,
        }),
      );

      return ok(new PageResult(items, totalItems, pageNumber, pageSize));
    } catch (error) {
      return err(new Error(`Failed to get jobs applied: ${error}`));
    }
  }

  async addJobApplicant(
    jobApplicant: JobApplicant,
  ): Promise<Result<undefined, Error>> {
    try {
      await this.prismaService.jobApplicant.create({
        data: {
          publicId: jobApplicant.publicId,
          jobId: jobApplicant.jobId,
          applicantId: jobApplicant.applicantId,
          resumeId: jobApplicant.resumeId,
          coverLetter: jobApplicant.coverLetter,
          proposedRate: jobApplicant.proposedRate,
          estimatedDay: jobApplicant.estimatedDay,
          status: mapJobApplicantStatusToPrisma(jobApplicant.status),
          appliedAt: jobApplicant.appliedAt,
          updatedAt: jobApplicant.updatedAt,
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to add job applicant ${error}`));
    }
  }
}
