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
import {
  bestEffortTelemetry,
  recordSpanError,
} from 'src/shared/observability/span-diagnostics';

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
        let processingError: unknown;
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const requestId = job.data.telemetry?.requestId ?? randomUUID();
        bestEffortTelemetry(() =>
          span.setAttributes({
            queue: QueueName.ResumeIngestion,
            job_id: job.id ?? '',
            request_id: requestId,
            attempt,
            max_attempts: maxAttempts,
            final_attempt: attempt >= maxAttempts,
            resume_public_id: job.data.resumePublicId,
            resume_content_public_id: job.data.resumeContentPublicId,
            'fitwork.queue.name': QueueName.ResumeIngestion,
            'fitwork.queue.attempt': attempt,
          }),
        );

        try {
          await this.ingestionService.ingest(
            job.data,
            job.attemptsMade,
            job.opts.attempts ?? 1,
          );
          bestEffortTelemetry(() =>
            span.setStatus({ code: SpanStatusCode.OK }),
          );
          outcome = 'success';
        } catch (error) {
          processingError = error;
          recordSpanError(span, error);
          throw error;
        } finally {
          const durationMs = Math.round(performance.now() - started);
          bestEffortTelemetry(() => span.setAttribute('outcome', outcome));
          bestEffortTelemetry(() =>
            span.setAttribute('fitwork.queue.outcome', outcome),
          );
          bestEffortTelemetry(() =>
            queueMetrics.attempt(
              QueueName.ResumeIngestion,
              job.attemptsMade,
              job.opts.attempts ?? 1,
              outcome,
              durationMs / 1000,
            ),
          );
          bestEffortTelemetry(() => {
            const spanContext = span.spanContext();
            this.jobLogger.job({
              requestId,
              jobId: job.id,
              resumePublicId: job.data.resumePublicId,
              resumeContentPublicId: job.data.resumeContentPublicId,
              queue: QueueName.ResumeIngestion,
              attempt,
              maxAttempts,
              outcome,
              durationMs,
              traceId: spanContext?.traceId,
              spanId: spanContext?.spanId,
              exception: processingError,
            });
          });
          bestEffortTelemetry(() => span.end());
        }
      },
    );
  }
}
