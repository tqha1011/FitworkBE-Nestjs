import { IngestionJobRequestDto } from 'src/shared/infrastructure/queue/type/ingestion-job.request.dto';

export abstract class IResumeIngestionService {
  abstract ingest(
    payload: IngestionJobRequestDto,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<void>;
}
