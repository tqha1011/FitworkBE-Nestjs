import { Result } from 'neverthrow';
import { JobApplicant } from '../entities/job-applicant.entity';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';

export type JobApplicantStatusContext = {
  jobId: number;
  jobOwnerId: number;
  status: CommonJobApplicantStatus;
  version: number;
  hasAcceptedApplicant: boolean;
};

export abstract class IJobApplicantRepository {
  abstract addJobApplicant(
    jobApplicant: JobApplicant,
  ): Promise<Result<undefined, Error>>;

  abstract transitionStatus(
    jobApplicantPublicId: string,
    jobId: number,
    expectedStatus: CommonJobApplicantStatus,
    nextStatus: CommonJobApplicantStatus,
  ): Promise<Result<boolean, Error>>;

  abstract getStatusContext(
    jobApplicantPublicId: string,
  ): Promise<Result<JobApplicantStatusContext | null, Error>>;

  abstract rejectAllApplicants(
    jobId: number,
  ): Promise<Result<undefined, Error>>;

  abstract acceptApplicantAndRejectOthers(
    jobApplicantPublicId: string,
    jobId: number,
    expectedStatus: CommonJobApplicantStatus,
    expectedVersion: number,
  ): Promise<Result<boolean, Error>>;
}
