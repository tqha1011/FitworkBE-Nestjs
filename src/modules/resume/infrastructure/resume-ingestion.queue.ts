import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IResumeIngestionQueue } from '../application/interfaces/resume-ingestion-queue.interface';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';

export const RESUME_INGESTION_ATTEMPTS = 3;

@Injectable()
export class ResumeIngestionQueue implements IResumeIngestionQueue {
  constructor(
    @InjectQueue(QueueName.ResumeIngestion)
    private readonly queue: Queue<ResumeIngestionJobDto>,
  ) {}

  async enqueue(payload: ResumeIngestionJobDto): Promise<void> {
    const jobId = payload.resumeContentPublicId;
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'failed' || state === 'completed') {
        await existingJob.remove();
      } else {
        return;
      }
    }

    await this.queue.add(EventName.IngestionResume, payload, {
      jobId,
      attempts: RESUME_INGESTION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
    });
  }
}
