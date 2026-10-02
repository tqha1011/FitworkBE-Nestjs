import { Job } from 'bullmq';
import { err, ok } from 'neverthrow';
import { propagation, Span, trace } from '@opentelemetry/api';
import { ApplicantEvaluationJobDto } from '../application/dtos/applicant-evaluation-job.dto';
import { ApplicantEvaluationProcessor } from './applicant-evaluation.processor';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  WorkerHost: class {},
}));

describe('ApplicantEvaluationProcessor', () => {
  afterEach(() => jest.restoreAllMocks());

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

  it('ends the span when processing fails', async () => {
    const end = jest.fn();
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (...args: unknown[]) => {
        const callback = args[3] as (span: Span) => Promise<void>;
        return callback({
          end,
          setStatus: jest.fn(),
          setAttribute: jest.fn(),
        } as unknown as Span);
      },
    } as never);
    const processor = new ApplicantEvaluationProcessor({
      process: jest.fn().mockResolvedValue(err(new Error('failed'))),
    });
    const job = {
      data: { evaluationPublicId: 'evaluation-id' },
      attemptsMade: 0,
      opts: {},
    } as Job<ApplicantEvaluationJobDto>;

    await expect(processor.process(job)).rejects.toThrow('failed');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('extracts the queued trace context before starting the consumer span', async () => {
    const parentContext = { getValue: jest.fn() } as never;
    const extract = jest
      .spyOn(propagation, 'extract')
      .mockReturnValue(parentContext);
    const startActiveSpan = jest.fn((...args: unknown[]) => {
      const callback = args[3] as (span: Span) => Promise<void>;
      return callback({
        end: jest.fn(),
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
      } as unknown as Span);
    });
    jest
      .spyOn(trace, 'getTracer')
      .mockReturnValue({ startActiveSpan } as never);
    const processor = new ApplicantEvaluationProcessor({
      process: jest.fn().mockResolvedValue(ok(undefined)),
    });
    const job = {
      data: {
        evaluationPublicId: 'evaluation-id',
        telemetry: { traceparent: '00-abc-def-01', tracestate: 'vendor=value' },
      },
      attemptsMade: 0,
      opts: {},
    } as Job<ApplicantEvaluationJobDto>;

    await processor.process(job);

    expect(extract).toHaveBeenCalledWith(expect.anything(), {
      traceparent: '00-abc-def-01',
      tracestate: 'vendor=value',
    });
    expect(startActiveSpan).toHaveBeenCalledWith(
      'evaluation.process',
      expect.anything(),
      parentContext,
      expect.any(Function),
    );
  });
});
