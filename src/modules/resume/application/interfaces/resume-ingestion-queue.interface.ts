import { ResumeIngestionJobDto } from '../dtos/resume-ingestion-job.dto';

export abstract class IResumeIngestionQueue {
  abstract enqueue(payload: ResumeIngestionJobDto): Promise<void>;
}
