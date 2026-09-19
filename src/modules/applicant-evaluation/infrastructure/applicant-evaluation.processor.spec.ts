import { Job } from 'bullmq';
import { err, ok } from 'neverthrow';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { ApplicantEvaluationProcessor } from './applicant-evaluation.processor';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  WorkerHost: class {},
}));

describe('ApplicantEvaluationProcessor', () => {
  it('uses the attempt configuration from the BullMQ job', async () => {
    const processingService = {
      process: jest.fn().mockResolvedValue(ok(undefined)),
    };
    const processor = new ApplicantEvaluationProcessor(processingService);
    const job = {
      data: { evaluationPublicId: 'evaluation-id' },
      attemptsMade: 1,
      opts: { attempts: 5 },
    } as Job<ApplicantEvaluationJobDto>;

    await processor.process(job);

    expect(processingService.process).toHaveBeenCalledWith(
      'evaluation-id',
      1,
      5,
    );
  });

  it('throws the processing error so BullMQ can retry', async () => {
    const processingError = new Error('Gemini unavailable');
    const processingService = {
      process: jest.fn().mockResolvedValue(err(processingError)),
    };
    const processor = new ApplicantEvaluationProcessor(processingService);
    const job = {
      data: { evaluationPublicId: 'evaluation-id' },
      attemptsMade: 0,
      opts: {},
    } as Job<ApplicantEvaluationJobDto>;

    await expect(processor.process(job)).rejects.toBe(processingError);
    expect(processingService.process).toHaveBeenCalledWith(
      'evaluation-id',
      0,
      1,
    );
  });
});
