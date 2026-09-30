import {
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { Job } from 'bullmq';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { ResumeIngestionProcessor } from './resume-ingestion.processor';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

describe('ResumeIngestionProcessor', () => {
  const payload = {
    resumePublicId: 'private-resume-id',
    resumeContentPublicId: 'private-content-id',
  };
  const job = {
    name: 'ingestion-resume',
    data: payload,
    attemptsMade: 1,
    opts: { attempts: 3 },
  } as Job<ResumeIngestionJobDto>;

  let ingest: jest.Mock;
  let startActiveSpan: jest.Mock;
  let span: { setAttribute: jest.Mock; setStatus: jest.Mock; end: jest.Mock };
  let processor: ResumeIngestionProcessor;

  beforeEach(() => {
    span = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    startActiveSpan = jest.fn(
      (
        _name: string,
        _options: object,
        _parentContext: unknown,
        callback: (activeSpan: Span) => unknown,
      ) => callback(span as unknown as Span),
    );
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan,
    } as Tracer);
    ingest = jest.fn().mockResolvedValue(undefined);
    processor = new ResumeIngestionProcessor({ ingest });
  });

  afterEach(() => jest.restoreAllMocks());

  it('records one processing span for a successful job attempt', async () => {
    await processor.process(job);

    expect(ingest).toHaveBeenCalledWith(payload, 1, 3);
    expect(startActiveSpan).toHaveBeenCalledWith(
      'queue.process',
      {},
      expect.anything(),
      expect.any(Function),
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.queue.name',
      QueueName.ResumeIngestion,
    );
    expect(span.setAttribute).toHaveBeenCalledWith('fitwork.queue.attempt', 2);
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.queue.outcome',
      'success',
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('marks a failed attempt as error and lets BullMQ retry it', async () => {
    const error = new Error('failed for private-resume-id');
    ingest.mockRejectedValue(error);

    await expect(processor.process(job)).rejects.toBe(error);

    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.queue.outcome',
      'error',
    );
    expect(JSON.stringify(span.setAttribute.mock.calls)).not.toContain(
      'private-resume-id',
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
