import { Result } from 'neverthrow';
import { Job } from '../entities/job.entity';
import { JobSnapshotV1 } from '../value-objects/job-snapshot';

export type JobSnapshotData = {
  jobId: number;
  snapshot: JobSnapshotV1;
};

export abstract class IJobRepository {
  abstract addJob(
    job: Job,
    skillIds: number[],
  ): Promise<Result<undefined, Error>>;
  abstract getJobIdByPublicId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;
  abstract getJobByPublicId(
    publicId: string,
  ): Promise<Result<Job | null, Error>>;
  abstract getJobDataForSnapshot(
    jobPublicId: string,
  ): Promise<Result<JobSnapshotData | null, Error>>;
  abstract updateJob(job: Job): Promise<Result<undefined, Error>>;

  abstract authorizeJobOwner(
    jobOwnerPublicId: string,
    jobPublicId: string,
  ): Promise<Result<undefined | null, Error>>;
}
