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
