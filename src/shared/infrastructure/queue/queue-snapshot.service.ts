import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Queue } from 'bullmq';
import { QueueName } from './constant/queue-name';

type Counts = { waiting: number; active: number };

@Injectable()
export class QueueSnapshotService implements OnModuleInit, OnModuleDestroy {
  private readonly meter = metrics.getMeter('fitwork.queue.snapshot');
  private readonly jobs =
    this.meter.createObservableGauge('fitwork_queue_jobs');
  private readonly errors = this.meter.createCounter(
    'fitwork_dependency_errors_total',
  );
  private readonly counts = new Map<QueueName, Counts>();
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectQueue(QueueName.ResumeIngestion)
    private readonly resumeQueue: Queue,
    @InjectQueue(QueueName.LlmEvaluation)
    private readonly evaluationQueue: Queue,
  ) {
    this.jobs.addCallback((result) => {
      for (const [queue, counts] of this.counts) {
        result.observe(counts.waiting, { queue, state: 'waiting' });
        result.observe(counts.active, { queue, state: 'active' });
      }
    });
  }

  onModuleInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    await Promise.all([
      this.refreshQueue(QueueName.ResumeIngestion, this.resumeQueue),
      this.refreshQueue(QueueName.LlmEvaluation, this.evaluationQueue),
    ]);
  }

  private async refreshQueue(name: QueueName, queue: Queue): Promise<void> {
    try {
      const counts = await queue.getJobCounts('waiting', 'active');
      this.counts.set(name, {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
      });
    } catch {
      this.errors.add(1, { dependency: 'redis', operation: 'queue_snapshot' });
    }
  }
}
