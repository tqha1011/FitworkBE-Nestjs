import { Result } from 'neverthrow';
import { JobApplicant } from '../entities/job-applicant.entity';

export abstract class IJobApplicantRepository {
  abstract addJobApplicant(
    jobApplicant: JobApplicant,
  ): Promise<Result<undefined, Error>>;
}
