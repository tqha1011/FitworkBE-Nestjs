import { Result } from 'neverthrow';
import { JobApplicant } from '../entities/job-applicant.entity';

export abstract class IJobApplicantRepository {
  abstract addJobApplicant(
    jobApplicant: JobApplicant,
  ): Promise<Result<undefined, Error>>;

  abstract acceptJobApplicant(
    jobApplicantPublicId: string,
    jobId: number,
    resumeId: number,
    applicantId: number,
  ): Promise<Result<undefined, Error>>;
}
