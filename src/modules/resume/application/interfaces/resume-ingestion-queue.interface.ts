import { IngestionJobRequestDto } from 'src/shared/infrastructure/queue/type/ingestion-job.request.dto';

export abstract class IResumeIngestionQueue {
  abstract enqueue(payload: IngestionJobRequestDto): Promise<void>;
}
