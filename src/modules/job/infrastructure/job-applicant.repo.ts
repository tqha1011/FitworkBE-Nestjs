import { err, ok, Result } from 'neverthrow';
import { IJobApplicantRepository } from '../domain/repositories/job-applicant.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { JobApplicant } from '../domain/entities/job-applicant.entity';
import { mapJobApplicantStatusToPrisma } from './job-applicant.mapper';

export class JobApplicantRepository implements IJobApplicantRepository {
  constructor(private readonly prismaService: PrismaService) {}

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
