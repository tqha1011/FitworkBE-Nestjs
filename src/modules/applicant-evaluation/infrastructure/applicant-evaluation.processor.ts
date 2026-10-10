import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { IApplicantEvaluationProcessingService } from '../application/interfaces/applicant-evaluation-processing.service.interface';
import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { StructuredLogger } from 'src/shared/observability/structured-logger';
import { queueMetrics } from 'src/shared/observability/queue-metrics';
import {
  bestEffortTelemetry,
  recordSpanError,
} from 'src/shared/observability/span-diagnostics';

@Processor(QueueName.LlmEvaluation)
export class ApplicantEvaluationProcessor extends WorkerHost {
  private readonly tracer = trace.getTracer('evaluation.processor');
  private readonly jobLogger = new StructuredLogger();
  constructor(
    private readonly processingService: IApplicantEvaluationProcessingService,
  ) {
    super();
  }

  async process(job: Job<ApplicantEvaluationJobDto>): Promise<void> {
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
      'evaluation.process',
      { kind: SpanKind.CONSUMER },
      parentContext,
      async (span) => {
        const started = performance.now();
        let outcome: 'success' | 'error' = 'error';
        let processingError: unknown;
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const requestId = job.data.telemetry?.requestId ?? randomUUID();
        bestEffortTelemetry(() =>
          span.setAttributes({
            queue: QueueName.LlmEvaluation,
            job_id: job.id ?? '',
            request_id: requestId,
            attempt,
            max_attempts: maxAttempts,
            final_attempt: attempt >= maxAttempts,
            evaluation_public_id: job.data.evaluationPublicId,
            'fitwork.queue.name': QueueName.LlmEvaluation,
            'fitwork.queue.attempt': attempt,
          }),
        );
        try {
          const result = await this.processingService.process(
            job.data.evaluationPublicId,
            job.attemptsMade,
            job.opts.attempts ?? 1,
          );
          if (result.isErr()) {
            throw result.error;
          }
          bestEffortTelemetry(() =>
            span.setStatus({ code: SpanStatusCode.OK }),
          );
          bestEffortTelemetry(() =>
            span.setAttribute('evaluation.processor.success', 'success'),
          );
          outcome = 'success';
        } catch (error) {
          processingError = error;
          recordSpanError(span, error);
          bestEffortTelemetry(() =>
            span.setAttribute('evaluation.processor.error', 'failed'),
          );
          throw error;
        } finally {
          const durationMs = Math.round(performance.now() - started);
          bestEffortTelemetry(() => span.setAttribute('outcome', outcome));
          bestEffortTelemetry(() =>
            span.setAttribute('fitwork.queue.outcome', outcome),
          );
          bestEffortTelemetry(() =>
            queueMetrics.attempt(
              QueueName.LlmEvaluation,
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
              evaluationPublicId: job.data.evaluationPublicId,
              queue: QueueName.LlmEvaluation,
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
