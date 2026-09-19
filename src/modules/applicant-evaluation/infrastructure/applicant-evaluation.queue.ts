import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { IApplicantEvaluationQueueInterface } from '../application/interfaces/applicant-evaluation.queue.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { Queue } from 'bullmq';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { Injectable } from '@nestjs/common';

export const APPLICANT_EVALUATION_ATTEMPTS = 3;

@Injectable()
export class ApplicantEvaluationQueue implements IApplicantEvaluationQueueInterface {
  constructor(
    @InjectQueue(QueueName.LlmEvaluation)
    private readonly queue: Queue<ApplicantEvaluationJobDto>,
  ) {}

  async enqueue(request: ApplicantEvaluationJobDto): Promise<void> {
    await this.queue.add(EventName.EvaluationApplicant, request, {
      jobId: request.evaluationPublicId,
      attempts: APPLICANT_EVALUATION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
    });
  }

  async retry(request: ApplicantEvaluationJobDto): Promise<void> {
    const existingJob = await this.queue.getJob(request.evaluationPublicId);
    if (!existingJob) {
      await this.enqueue(request);
      return;
    }

    const state = await existingJob.getState();
    if (state === 'failed') {
      await existingJob.retry();
    }
  }
}
