import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IResumeIngestionService } from '../application/interfaces/resume-ingestion.service.interface';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { IngestionJobRequestDto } from 'src/shared/infrastructure/queue/type/ingestion-job.request.dto';

@Processor(QueueName.ResumeIngestion, { concurrency: 2 })
export class ResumeIngestionProcessor extends WorkerHost {
  constructor(private readonly ingestionService: IResumeIngestionService) {
    super();
  }

  async process(job: Job<IngestionJobRequestDto>): Promise<void> {
    await this.ingestionService.ingest(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? 1,
    );
  }
}
