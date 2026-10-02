import { metrics } from '@opentelemetry/api';
import { QueueMetrics } from './queue-metrics';

describe('QueueMetrics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts an actual retry attempt and only final failures', () => {
    const calls: string[] = [];
    const record = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn((name: string) => ({
        add: () => calls.push(name),
      })),
      createHistogram: jest.fn().mockReturnValue({ record }),
    } as never);
    const telemetry = new QueueMetrics();

    telemetry.attempt('llm-evaluation', 1, 3, 'error', 0.5);
    telemetry.attempt('llm-evaluation', 2, 3, 'error', 0.7);

    expect(calls).toEqual([
      'fitwork_queue_retries_total',
      'fitwork_queue_retries_total',
      'fitwork_queue_failed_total',
    ]);
    expect(record).toHaveBeenCalledWith(0.5, {
      queue: 'llm-evaluation',
      outcome: 'error',
    });
  });
});
