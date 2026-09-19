import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { IResumeIngestionService } from '../application/interfaces/resume-ingestion.service.interface';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';

@Processor(QueueName.ResumeIngestion, { concurrency: 2 })
export class ResumeIngestionProcessor extends WorkerHost {
  constructor(private readonly ingestionService: IResumeIngestionService) {
    super();
  }

  async process(job: Job<ResumeIngestionJobDto>): Promise<void> {
    await this.ingestionService.ingest(
      job.data,
      job.attemptsMade,
      job.opts.attempts ?? 1,
    );
  }
}
