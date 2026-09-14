import { Result } from 'neverthrow';
import { Job } from '../entities/job.entity';

export abstract class IJobRepository {
  abstract addJob(
    job: Job,
    skillIds: number[],
  ): Promise<Result<undefined, Error>>;
  abstract getJobIdByPublicId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;
}
