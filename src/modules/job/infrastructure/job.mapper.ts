import { JobStatus } from 'generated/prisma/enums';
import { CommonJobStatus } from 'src/shared/domain/enum';

const statusToPrisma: Record<CommonJobStatus, JobStatus> = {
  [CommonJobStatus.OPEN]: JobStatus.OPEN,
  [CommonJobStatus.CLOSED]: JobStatus.CLOSED,
};

const statusToDomain: Record<JobStatus, CommonJobStatus> = {
  [JobStatus.OPEN]: CommonJobStatus.OPEN,
  [JobStatus.CLOSED]: CommonJobStatus.CLOSED,
};

export function mapStatusToPrisma(status: CommonJobStatus): JobStatus {
  return statusToPrisma[status];
}

export function mapStatusToDomain(status: JobStatus): CommonJobStatus {
  return statusToDomain[status];
}
