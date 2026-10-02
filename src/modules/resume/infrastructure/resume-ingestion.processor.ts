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
import { randomUUID } from 'node:crypto';
import { StructuredLogger } from 'src/shared/observability/structured-logger';
import { queueMetrics } from 'src/shared/observability/queue-metrics';

@Processor(QueueName.ResumeIngestion, { concurrency: 2 })
export class ResumeIngestionProcessor extends WorkerHost {
  private readonly tracer = trace.getTracer('fitwork.resume.queue');
  private readonly jobLogger = new StructuredLogger();

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
        const started = performance.now();
        let outcome: 'success' | 'error' = 'error';
        span.setAttribute('fitwork.queue.name', QueueName.ResumeIngestion);
        span.setAttribute('fitwork.queue.attempt', job.attemptsMade + 1);

        try {
          await this.ingestionService.ingest(
            job.data,
            job.attemptsMade,
            job.opts.attempts ?? 1,
          );
          span.setAttribute('fitwork.queue.outcome', 'success');
          outcome = 'success';
        } catch (error) {
          span.setAttribute('fitwork.queue.outcome', 'error');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          const durationMs = Math.round(performance.now() - started);
          queueMetrics.attempt(
            QueueName.ResumeIngestion,
            job.attemptsMade,
            job.opts.attempts ?? 1,
            outcome,
            durationMs / 1000,
          );
          const spanContext = span.spanContext?.();
          this.jobLogger.job({
            requestId: job.data.telemetry?.requestId ?? randomUUID(),
            queue: QueueName.ResumeIngestion,
            attempt: job.attemptsMade + 1,
            outcome,
            durationMs,
            traceId: spanContext?.traceId,
            spanId: spanContext?.spanId,
          });
          span.end();
        }
      },
    );
  }
}
