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

@Processor(QueueName.LlmEvaluation)
export class ApplicantEvaluationProcessor extends WorkerHost {
  private readonly tracer = trace.getTracer('evaluation.processor');
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
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute('evaluation.processor.error', 'failed');
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
