import { metrics } from '@opentelemetry/api';
import { QueueSnapshotService } from './queue-snapshot.service';

jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));

describe('QueueSnapshotService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('observes waiting and active counts for both queues', async () => {
    let observeCallback: ((result: { observe: jest.Mock }) => void) | undefined;
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createObservableGauge: jest.fn().mockReturnValue({
        addCallback: jest.fn((callback) => {
          observeCallback = callback as typeof observeCallback;
        }),
      }),
      createCounter: jest.fn().mockReturnValue({ add: jest.fn() }),
    } as never);
    const resume = {
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 2, active: 1 }),
    };
    const evaluation = {
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 3, active: 0 }),
    };
    const service = new QueueSnapshotService(
      resume as never,
      evaluation as never,
    );

    await service.refresh();
    const observe = jest.fn();
    observeCallback?.({ observe });

    expect(observe).toHaveBeenCalledWith(2, {
      queue: 'resume-ingestion',
      state: 'waiting',
    });
    expect(observe).toHaveBeenCalledWith(0, {
      queue: 'llm-evaluation',
      state: 'active',
    });
  });
});
