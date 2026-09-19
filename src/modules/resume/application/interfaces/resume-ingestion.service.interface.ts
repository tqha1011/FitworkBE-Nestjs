import { ResumeIngestionJobDto } from '../dtos/resume-ingestion-job.dto';

export abstract class IResumeIngestionService {
  abstract ingest(
    payload: ResumeIngestionJobDto,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<void>;
}
