import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { IApplicantEvaluationQueueInterface } from '../application/interfaces/applicant-evaluation.queue.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { Queue } from 'bullmq';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { Injectable } from '@nestjs/common';
import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import { requestContext } from 'src/shared/observability/request-context';

export const APPLICANT_EVALUATION_ATTEMPTS = 3;

@Injectable()
export class ApplicantEvaluationQueue implements IApplicantEvaluationQueueInterface {
  private readonly tracer = trace.getTracer('evaluation.queue');
  constructor(
    @InjectQueue(QueueName.LlmEvaluation)
    private readonly queue: Queue<ApplicantEvaluationJobDto>,
  ) {}

  async enqueue(request: ApplicantEvaluationJobDto): Promise<void> {
    await this.tracer.startActiveSpan(
      'evaluation.enqueue',
      { kind: SpanKind.PRODUCER },
      async (span) => {
        try {
          const carrier: Record<string, string> = {};
          propagation.inject(context.active(), carrier);
          const requestId = requestContext.getStore()?.requestId;
          const payload: ApplicantEvaluationJobDto = {
            evaluationPublicId: request.evaluationPublicId,
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
          await this.queue.add(EventName.EvaluationApplicant, payload, {
            jobId: request.evaluationPublicId,
            attempts: APPLICANT_EVALUATION_ATTEMPTS,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
            removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
          });
        } finally {
          span.end();
        }
      },
    );
  }

  async retry(request: ApplicantEvaluationJobDto): Promise<void> {
    const existingJob = await this.queue.getJob(request.evaluationPublicId);
    if (!existingJob) {
      await this.enqueue(request);
      return;
    }

    const state = await existingJob.getState();
    if (state === 'failed') {
      await this.tracer.startActiveSpan(
        'evaluation.retry',
        { kind: SpanKind.PRODUCER },
        async (span) => {
          try {
            const carrier: Record<string, string> = {};
            propagation.inject(context.active(), carrier);
            const requestId = requestContext.getStore()?.requestId;
            const telemetry = {
              ...existingJob.data?.telemetry,
              ...(carrier.traceparent
                ? { traceparent: carrier.traceparent }
                : {}),
              ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
              ...(requestId ? { requestId } : {}),
            };
            await existingJob.updateData({
              evaluationPublicId: request.evaluationPublicId,
              ...(Object.keys(telemetry).length ? { telemetry } : {}),
            });
            await existingJob.retry();
          } finally {
            span.end();
          }
        },
      );
    }
  }
}
