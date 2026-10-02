import { metrics } from '@opentelemetry/api';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';

export class QueueMetrics {
  private readonly meter = metrics.getMeter('fitwork.queue');
  private readonly completed = this.meter.createCounter(
    'fitwork_queue_completed_total',
  );
  private readonly failed = this.meter.createCounter(
    'fitwork_queue_failed_total',
  );
  private readonly retries = this.meter.createCounter(
    'fitwork_queue_retries_total',
  );
  private readonly duration = this.meter.createHistogram(
    'fitwork_queue_processing_duration_seconds',
    { unit: 's' },
  );

  attempt(
    queue: QueueName,
    attemptsMade: number,
    maxAttempts: number,
    outcome: 'success' | 'error',
    seconds: number,
  ): void {
    const labels = { queue };
    if (attemptsMade > 0) this.retries.add(1, labels);
    if (outcome === 'success') this.completed.add(1, labels);
    if (outcome === 'error' && attemptsMade + 1 >= maxAttempts) {
      this.failed.add(1, labels);
    }
    this.duration.record(seconds, { ...labels, outcome });
  }
}

export const queueMetrics = new QueueMetrics();
