import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { Job } from 'bullmq';
import { IResumeIngestionService } from '../application/interfaces/resume-ingestion.service.interface';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';

@Processor(QueueName.ResumeIngestion, { concurrency: 2 })
export class ResumeIngestionProcessor extends WorkerHost {
  private readonly tracer = trace.getTracer('fitwork.resume.queue');

  constructor(private readonly ingestionService: IResumeIngestionService) {
    super();
  }

  async process(job: Job<ResumeIngestionJobDto>): Promise<void> {
    const traceparent = job.data.telemetry?.traceparent;
    const tracestate = job.data.telemetry?.tracestate;
    const parentContext =
      typeof traceparent === 'string'
        ? propagation.extract(ROOT_CONTEXT, {
            traceparent,
            ...(typeof tracestate === 'string' ? { tracestate } : {}),
          })
        : ROOT_CONTEXT;

    return this.tracer.startActiveSpan(
      'queue.process',
      { kind: SpanKind.CONSUMER },
      parentContext,
      async (span): Promise<void> => {
        span.setAttribute('fitwork.queue.name', QueueName.ResumeIngestion);
        span.setAttribute('fitwork.queue.attempt', job.attemptsMade + 1);

        try {
          await this.ingestionService.ingest(
            job.data,
            job.attemptsMade,
            job.opts.attempts ?? 1,
          );
          span.setAttribute('fitwork.queue.outcome', 'success');
        } catch (error) {
          span.setAttribute('fitwork.queue.outcome', 'error');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
