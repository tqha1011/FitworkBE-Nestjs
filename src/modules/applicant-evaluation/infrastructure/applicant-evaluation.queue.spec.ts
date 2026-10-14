import { Queue } from 'bullmq';
import { propagation } from '@opentelemetry/api';
import { requestContext } from 'src/shared/observability/request-context';
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
  it('reconciles a demo retry while the original failed worker is still active', async () => {
    const original = {
      getState: jest
        .fn()
        .mockResolvedValueOnce('active')
        .mockResolvedValue('failed'),
      updateData: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
      data: {},
    };
    const queue = { getJob: jest.fn().mockResolvedValue(original) };
    const service = new ApplicantEvaluationQueue(
      queue as unknown as Queue<ApplicantEvaluationJobDto>,
    );
    await service.retry({ evaluationPublicId: 'demo-retry', demo: true });
    expect(original.retry).toHaveBeenCalledTimes(1);
  });
  afterEach(() => jest.restoreAllMocks());

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

  it('injects the active trace context into a new job', async () => {
    const inject = jest
      .spyOn(propagation, 'inject')
      .mockImplementation((_context, carrier) => {
        Object.assign(carrier as object, {
          traceparent: '00-abc-def-01',
          tracestate: 'vendor=value',
        });
      });
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = new ApplicantEvaluationQueue({
      add,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.enqueue(request);

    expect(inject).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      EventName.EvaluationApplicant,
      {
        evaluationPublicId: request.evaluationPublicId,
        telemetry: {
          traceparent: '00-abc-def-01',
          tracestate: 'vendor=value',
        },
      },
      expect.anything(),
    );
  });

  it('retries an existing failed job', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const retry = jest.fn().mockResolvedValue(undefined);
    const updateData = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('failed');
    const getJob = jest.fn().mockResolvedValue({ getState, retry, updateData });
    const queue = new ApplicantEvaluationQueue({
      add,
      getJob,
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await queue.retry(request);

    expect(getJob).toHaveBeenCalledWith(request.evaluationPublicId);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluationPublicId: request.evaluationPublicId,
      }),
    );
    expect(add).not.toHaveBeenCalled();
  });

  it('uses the current request context when retrying a failed job', async () => {
    jest
      .spyOn(propagation, 'inject')
      .mockImplementation((_context, carrier) => {
        Object.assign(carrier as object, { traceparent: 'new-parent' });
      });
    const retry = jest.fn().mockResolvedValue(undefined);
    const updateData = jest.fn().mockResolvedValue(undefined);
    const queue = new ApplicantEvaluationQueue({
      getJob: jest.fn().mockResolvedValue({
        data: request,
        getState: jest.fn().mockResolvedValue('failed'),
        updateData,
        retry,
      }),
    } as unknown as Queue<ApplicantEvaluationJobDto>);

    await requestContext.run({ requestId: 'new-request' }, () =>
      queue.retry(request),
    );

    expect(updateData).toHaveBeenCalledWith({
      evaluationPublicId: request.evaluationPublicId,
      telemetry: { traceparent: 'new-parent', requestId: 'new-request' },
    });
    expect(retry).toHaveBeenCalledTimes(1);
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
