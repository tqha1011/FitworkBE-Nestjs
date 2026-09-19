import { Queue } from 'bullmq';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import {
  APPLICANT_EVALUATION_ATTEMPTS,
  ApplicantEvaluationQueue,
} from './applicant-evaluation.queue';

jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

describe('ApplicantEvaluationQueue', () => {
  const request: ApplicantEvaluationJobDto = {
    evaluationPublicId: 'evaluation-id',
  };

  it('adds an ID-only evaluation job using the evaluation id as job id', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = new ApplicantEvaluationQueue({
      add,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.enqueue(request);

    expect(add).toHaveBeenCalledWith(EventName.EvaluationApplicant, request, {
      jobId: request.evaluationPublicId,
      attempts: APPLICANT_EVALUATION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });
  });

  it('retries an existing failed job', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const retry = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('failed');
    const getJob = jest.fn().mockResolvedValue({ getState, retry });
    const queue = new ApplicantEvaluationQueue({
      add,
      getJob,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.retry(request);

    expect(getJob).toHaveBeenCalledWith(request.evaluationPublicId);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues the job when there is no BullMQ job to retry', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const getJob = jest.fn().mockResolvedValue(undefined);
    const queue = new ApplicantEvaluationQueue({
      add,
      getJob,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.retry(request);

    expect(add).toHaveBeenCalledWith(
      EventName.EvaluationApplicant,
      request,
      expect.objectContaining({ jobId: request.evaluationPublicId }),
    );
  });

  it('does not duplicate a job that is not failed', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const retry = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('active');
    const getJob = jest.fn().mockResolvedValue({ getState, retry });
    const queue = new ApplicantEvaluationQueue({
      add,
      getJob,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.retry(request);

    expect(retry).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
