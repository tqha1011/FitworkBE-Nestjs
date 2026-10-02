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
        try {
          const result = await this.processingService.process(
            job.data.evaluationPublicId,
            job.attemptsMade,
            job.opts.attempts ?? 1,
          );
          if (result.isErr()) {
            throw result.error;
          }
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('evaluation.processor.success', 'success');
          outcome = 'success';
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute('evaluation.processor.error', 'failed');
          throw error;
        } finally {
          const durationMs = Math.round(performance.now() - started);
          queueMetrics.attempt(
            QueueName.LlmEvaluation,
            job.attemptsMade,
            job.opts.attempts ?? 1,
            outcome,
            durationMs / 1000,
          );
          const spanContext = span.spanContext?.();
          this.jobLogger.job({
            requestId: job.data.telemetry?.requestId ?? randomUUID(),
            queue: QueueName.LlmEvaluation,
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
