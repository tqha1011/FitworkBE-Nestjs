import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Job, Queue } from 'bullmq';
import { ok } from 'neverthrow';
import {
  CommonFileType,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { ResumeIngestionJobDto } from '../application/dtos/resume-ingestion-job.dto';
import { IResumeIngestionNotifier } from '../application/interfaces/resume-ingestion-notifier.interface';
import { IResumeTextExtractor } from '../application/interfaces/resume-text-extractor.interface';
import { ResumeIngestionService } from '../application/services/resume-ingestion.service';
import { ResumeContentRecord } from '../domain/entities/resume-content.entity';
import { IResumeContentRepository } from '../domain/repositories/resume-content.repo.interface';
import { ResumeIngestionProcessor } from './resume-ingestion.processor';
import { ResumeIngestionQueue } from './resume-ingestion.queue';

jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

describe('resume ingestion trace across BullMQ', () => {
  const payload: ResumeIngestionJobDto = {
    resumePublicId: 'private-resume-id',
    resumeContentPublicId: 'private-content-id',
  };
  const now = new Date('2026-01-01T00:00:00.000Z');
  const completedContent: ResumeContentRecord = {
    id: 1,
    publicId: payload.resumeContentPublicId,
    resumeId: 2,
    resumePublicId: payload.resumePublicId,
    ownerPublicId: 'private-owner-id',
    status: CommonResumeIngestionStatus.COMPLETED,
    errorMessage: null,
    storagePath: 'private/path',
    fileSize: 4,
    fileType: CommonFileType.PDF,
    fileName: 'private.pdf',
    parserVersion: 'test',
    extractedText: 'text',
    contentHash: 'hash',
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  beforeEach(() => exporter.reset());

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  const makeProcessor = () => {
    const service = new ResumeIngestionService(
      {
        getByPublicId: jest.fn().mockResolvedValue(ok(completedContent)),
      } as unknown as IResumeContentRepository,
      {} as IFileStorage,
      {} as IResumeTextExtractor,
      {} as IResumeIngestionNotifier,
    );
    return new ResumeIngestionProcessor(service);
  };

  it('links enqueue, every worker attempt, and ingest in one trace', async () => {
    let queuedData: ResumeIngestionJobDto | undefined;
    const queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest
        .fn()
        .mockImplementation((_name, data: ResumeIngestionJobDto) => {
          queuedData = data;
        }),
    } as unknown as Queue<ResumeIngestionJobDto>;

    await new ResumeIngestionQueue(queue).enqueue(payload);
    expect(queuedData?.telemetry?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );
    expect(payload).not.toHaveProperty('telemetry');

    const processor = makeProcessor();
    for (const attemptsMade of [0, 1]) {
      await processor.process({
        data: queuedData,
        attemptsMade,
        opts: { attempts: 3 },
      } as Job<ResumeIngestionJobDto>);
    }

    const spans = exporter.getFinishedSpans();
    const enqueue = spans.find((span) => span.name === 'enqueue.resume');
    const processes = spans.filter((span) => span.name === 'queue.process');
    const ingests = spans.filter((span) => span.name === 'ingest.resume');
    expect(enqueue).toBeDefined();
    expect(processes).toHaveLength(2);
    expect(ingests).toHaveLength(2);
    for (const process of processes) {
      expect(process.spanContext().traceId).toBe(
        enqueue?.spanContext().traceId,
      );
      expect(process.parentSpanContext?.spanId).toBe(
        enqueue?.spanContext().spanId,
      );
    }
    expect(
      ingests.map((span) => span.parentSpanContext?.spanId).sort(),
    ).toEqual(processes.map((span) => span.spanContext().spanId).sort());
  });

  it.each([undefined, 'invalid-traceparent'])(
    'processes a job with traceparent %s as a root trace',
    async (traceparent) => {
      await makeProcessor().process({
        data: {
          ...payload,
          ...(traceparent ? { telemetry: { traceparent } } : {}),
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as Job<ResumeIngestionJobDto>);

      const spans = exporter.getFinishedSpans();
      const process = spans.find((span) => span.name === 'queue.process');
      const ingest = spans.find((span) => span.name === 'ingest.resume');
      expect(process?.parentSpanContext).toBeUndefined();
      expect(ingest?.parentSpanContext?.spanId).toBe(
        process?.spanContext().spanId,
      );
    },
  );
});
