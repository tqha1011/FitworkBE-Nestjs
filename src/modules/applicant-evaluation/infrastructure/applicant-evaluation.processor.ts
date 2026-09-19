import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { IApplicantEvaluationProcessingService } from '../application/interfaces/applicant-evaluation-processing.service.interface';

@Processor(QueueName.LlmEvaluation)
export class ApplicantEvaluationProcessor extends WorkerHost {
  constructor(
    private readonly processingService: IApplicantEvaluationProcessingService,
  ) {
    super();
  }

  async process(job: Job<ApplicantEvaluationJobDto>): Promise<void> {
    const result = await this.processingService.process(
      job.data.evaluationPublicId,
    );
    if (result.isErr()) {
      throw result.error;
    }
  }
}
