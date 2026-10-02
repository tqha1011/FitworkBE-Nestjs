import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IResumeIngestionQueue } from '../application/interfaces/resume-ingestion-queue.interface';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { requestContext } from 'src/shared/observability/request-context';

export const RESUME_INGESTION_ATTEMPTS = 3;

@Injectable()
export class ResumeIngestionQueue implements IResumeIngestionQueue {
  private readonly trace = trace.getTracer('fitwork.ingestion.queue');
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

    return this.trace.startActiveSpan(
      'enqueue.resume',
      { kind: SpanKind.PRODUCER },
      async (span) => {
        try {
          const carrier: Record<string, string> = {};
          propagation.inject(context.active(), carrier);
          const requestId = requestContext.getStore()?.requestId;
          const queuedPayload: ResumeIngestionJobDto = {
            resumePublicId: payload.resumePublicId,
            resumeContentPublicId: payload.resumeContentPublicId,
            ...(carrier.traceparent || requestId
              ? {
                  telemetry: {
                    ...(carrier.traceparent
                      ? { traceparent: carrier.traceparent }
                      : {}),
                    ...(carrier.tracestate
                      ? { tracestate: carrier.tracestate }
                      : {}),
                    ...(requestId ? { requestId } : {}),
                  },
                }
              : {}),
          };

          await this.queue.add(EventName.IngestionResume, queuedPayload, {
            jobId,
            attempts: RESUME_INGESTION_ATTEMPTS,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
          });
          span.setAttribute('resume.enqueue', 'success');
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.setAttribute('resume.enqueue', 'failed');
          span.setStatus({
            code: SpanStatusCode.ERROR,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
