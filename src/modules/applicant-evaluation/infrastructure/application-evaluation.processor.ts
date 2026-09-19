import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';

@Processor(QueueName.LlmEvaluation)
export class ApplicationEvaluationProcessor extends WorkerHost {
  async process(): Promise<void> {}
}
