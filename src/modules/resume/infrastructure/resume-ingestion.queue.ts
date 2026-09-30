import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IResumeIngestionQueue } from '../application/interfaces/resume-ingestion-queue.interface';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';
import { SpanStatusCode, trace } from '@opentelemetry/api';

export const RESUME_INGESTION_ATTEMPTS = 3;

@Injectable()
export class ResumeIngestionQueue implements IResumeIngestionQueue {
  private readonly trace = trace.getTracer('fitwork.ingestion.queue');
  constructor(
    @InjectQueue(QueueName.ResumeIngestion)
    private readonly queue: Queue<ResumeIngestionJobDto>,
  ) {}

  async enqueue(payload: ResumeIngestionJobDto): Promise<void> {
    return this.trace.startActiveSpan(
      'ingestion.resume',
      async (parentSpan) => {
        try {
          const jobId = payload.resumeContentPublicId;
          const existingJob = await this.queue.getJob(jobId);
          if (existingJob) {
            const state = await existingJob.getState();
            if (state === 'failed' || state === 'completed') {
              await existingJob.remove();
              parentSpan.setAttribute('resume.enqueue', 'removed');
            } else {
              parentSpan.setAttribute('resume.enqueue', 'processing');
              parentSpan.setAttribute('resume.job.state', state);
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
          parentSpan.setAttribute('resume.enqueue', 'success');
          parentSpan.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          parentSpan.setAttribute('resume.enqueue', 'failed');
          parentSpan.setStatus({
            code: SpanStatusCode.ERROR,
          });
          throw error;
        } finally {
          parentSpan.end();
        }
      },
    );
  }
}
