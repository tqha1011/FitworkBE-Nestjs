import { Queue } from 'bullmq';
import { EventName } from 'src/shared/infrastructure/queue/constant/event-name';
import { IngestionJobRequestDto } from 'src/shared/infrastructure/queue/type/ingestion-job.request.dto';
import {
  RESUME_INGESTION_ATTEMPTS,
  ResumeIngestionQueue,
} from './resume-ingestion.queue';

jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

describe('ResumeIngestionQueue', () => {
  const payload = {
    resumePublicId: 'resume-id',
    resumeContentPublicId: 'content-id',
  };
  let queue: { getJob: jest.Mock; add: jest.Mock };
  let producer: ResumeIngestionQueue;

  beforeEach(() => {
    queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
    };
    producer = new ResumeIngestionQueue(
      queue as unknown as Queue<IngestionJobRequestDto>,
    );
  });

  it('adds a deterministic job with retry, backoff and retention options', async () => {
    await producer.enqueue(payload);

    expect(queue.add).toHaveBeenCalledWith(EventName.IngestionResume, payload, {
      jobId: payload.resumeContentPublicId,
      attempts: RESUME_INGESTION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });
  });

  it('reuses an active deterministic job', async () => {
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    });

    await producer.enqueue(payload);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('removes a retained failed job before retrying', async () => {
    const existing = {
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(existing);

    await producer.enqueue(payload);

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });
});
