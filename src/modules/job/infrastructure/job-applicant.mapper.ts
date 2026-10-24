import { JobApplicantStatus } from 'generated/prisma/enums';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';

const statusToPrisma: Record<CommonJobApplicantStatus, JobApplicantStatus> = {
  [CommonJobApplicantStatus.PENDING]: JobApplicantStatus.PENDING,
  [CommonJobApplicantStatus.ACCEPTED]: JobApplicantStatus.ACCEPTED,
  [CommonJobApplicantStatus.REJECTED]: JobApplicantStatus.REJECTED,
  [CommonJobApplicantStatus.COMPLETED]: JobApplicantStatus.COMPLETED,
};

const statusToDomain: Record<JobApplicantStatus, CommonJobApplicantStatus> = {
  [JobApplicantStatus.PENDING]: CommonJobApplicantStatus.PENDING,
  [JobApplicantStatus.ACCEPTED]: CommonJobApplicantStatus.ACCEPTED,
  [JobApplicantStatus.REJECTED]: CommonJobApplicantStatus.REJECTED,
  [JobApplicantStatus.COMPLETED]: CommonJobApplicantStatus.COMPLETED,
};

// Statuses covered by the job_applicant_one_accepted_per_job partial unique index.
export const ACCEPTED_JOB_APPLICANT_STATUSES: JobApplicantStatus[] = [
  JobApplicantStatus.ACCEPTED,
  JobApplicantStatus.COMPLETED,
];

export function mapJobApplicantStatusToPrisma(
  status: CommonJobApplicantStatus,
): JobApplicantStatus {
  return statusToPrisma[status];
}

export function mapJobApplicantStatusToDomain(
  status: JobApplicantStatus,
): CommonJobApplicantStatus {
  return statusToDomain[status];
}
