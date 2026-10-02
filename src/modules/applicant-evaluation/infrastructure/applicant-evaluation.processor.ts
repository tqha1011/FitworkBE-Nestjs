import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { IApplicantEvaluationProcessingService } from '../application/interfaces/applicant-evaluation-processing.service.interface';
import { SpanStatusCode, trace } from '@opentelemetry/api';

@Processor(QueueName.LlmEvaluation)
export class ApplicantEvaluationProcessor extends WorkerHost {
  private readonly tracer = trace.getTracer('evaluation.processor');
  constructor(
    private readonly processingService: IApplicantEvaluationProcessingService,
  ) {
    super();
  }

  async process(job: Job<ApplicantEvaluationJobDto>): Promise<void> {
    return this.tracer.startActiveSpan(
      'evaluation.process',
      async (parentSpan) => {
        const result = await this.processingService.process(
          job.data.evaluationPublicId,
          job.attemptsMade,
          job.opts.attempts ?? 1,
          job.data.telemetry,
        );
        if (result.isErr()) {
          parentSpan.setStatus({ code: SpanStatusCode.ERROR });
          parentSpan.setAttribute('evaluation.processor.error', 'failed');
          throw result.error;
        }
        parentSpan.setStatus({ code: SpanStatusCode.OK });
        parentSpan.setAttribute('evaluation.processor.success', 'success');
        parentSpan.end();
      },
    );
  }
}
