import { trace, SpanStatusCode } from '@opentelemetry/api';
import { logs, SeverityNumber, type LogRecord } from '@opentelemetry/api-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Job } from 'bullmq';
import { err, ok } from 'neverthrow';
import { ApplicantEvaluationProcessor } from 'src/modules/applicant-evaluation/infrastructure/applicant-evaluation.processor';
import { ResumeIngestionProcessor } from 'src/modules/resume/infrastructure/resume-ingestion.processor';
import { StructuredLogger } from './structured-logger';
import { queueMetrics } from './queue-metrics';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  WorkerHost: class {},
}));

describe.each(['evaluation', 'resume'] as const)(
  '%s job diagnostics',
  (kind) => {
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider;
    let write: jest.SpyInstance<
      ReturnType<typeof process.stdout.write>,
      Parameters<typeof process.stdout.write>
    >;
    let emit: jest.Mock<void, [LogRecord]>;
    beforeEach(() => {
      exporter = new InMemorySpanExporter();
      provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      jest
        .spyOn(trace, 'getTracer')
        .mockReturnValue(provider.getTracer('processor-test'));
      write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
      emit = jest.fn<void, [LogRecord]>();
      jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await provider.shutdown();
    });

    function fixture(
      attemptsMade: number,
      maxAttempts: number | undefined,
      failureMode: 'success' | 'throw' | 'err',
      failure: unknown,
    ) {
      const service = jest.fn(() => {
        if (failureMode === 'throw') throw failure;
        return Promise.resolve(
          failureMode === 'err' ? err(failure as Error) : ok(undefined),
        );
      });
      const job = {
        id: 'bull-job-42',
        attemptsMade,
        opts: { attempts: maxAttempts },
        data: {
          evaluationPublicId: 'evaluation-42',
          resumePublicId: 'resume-42',
          resumeContentPublicId: 'content-42',
          telemetry: { requestId: 'request-42' },
        },
      };
      const processor =
        kind === 'evaluation'
          ? new ApplicantEvaluationProcessor({ process: service })
          : new ResumeIngestionProcessor({
              ingest: async () => {
                await service();
              },
            });
      return () => processor.process(job as Job);
    }

    it.each([
      ['success', 0, 3, 'queue.job.completed', SeverityNumber.INFO, false],
      ['success', 2, 3, 'queue.job.completed', SeverityNumber.INFO, true],
      ['throw', 0, 3, 'queue.job.failed', SeverityNumber.WARN, false],
      ['throw', 2, 3, 'queue.job.failed', SeverityNumber.ERROR, true],
      ['throw', 0, undefined, 'queue.job.failed', SeverityNumber.ERROR, true],
    ] as const)(
      'records exactly one outcome for %s attempt %i/%s',
      async (
        mode,
        attemptsMade,
        maxAttempts,
        event,
        severity,
        finalAttempt,
      ) => {
        const root = Object.assign(
          new Error('Gemini 404 NOT_FOUND token=private alice@example.com'),
          { code: 'NOT_FOUND', name: 'ApiError' },
        );
        const failure = new Error('Dependency failed', { cause: root });
        const run = fixture(attemptsMade, maxAttempts, mode, failure);
        if (mode === 'success') await run();
        else await expect(run()).rejects.toBe(failure);
        await provider.forceFlush();
        expect(write).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledTimes(1);
        const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
          string,
          unknown
        >;
        expect(output).toEqual(
          expect.objectContaining({
            event,
            queue:
              kind === 'evaluation' ? 'llm-evaluation' : 'resume-ingestion',
            job_id: 'bull-job-42',
            attempt: attemptsMade + 1,
            max_attempts: maxAttempts ?? 1,
            final_attempt: finalAttempt,
            request_id: 'request-42',
          }),
        );
        expect(output.duration_ms).toEqual(expect.any(Number));
        expect(emit.mock.calls[0][0].severityNumber).toBe(severity);
        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(1);
        const span = spans[0];
        const publicIds =
          kind === 'evaluation'
            ? { evaluation_public_id: 'evaluation-42' }
            : {
                resume_public_id: 'resume-42',
                resume_content_public_id: 'content-42',
              };
        expect(output).toEqual(expect.objectContaining(publicIds));
        expect(output.trace_id).toBe(span.spanContext().traceId);
        expect(output.span_id).toBe(span.spanContext().spanId);
        expect(span.attributes).toEqual(
          expect.objectContaining({
            ...publicIds,
            job_id: 'bull-job-42',
            attempt: attemptsMade + 1,
            max_attempts: maxAttempts ?? 1,
            final_attempt: finalAttempt,
            outcome: mode === 'success' ? 'success' : 'error',
          }),
        );
        if (mode === 'success') expect(span.events).toHaveLength(0);
        else {
          expect(span.status.code).toBe(SpanStatusCode.ERROR);
          expect(span.events).toHaveLength(1);
          expect(span.events[0]).toEqual(
            expect.objectContaining({
              name: 'exception',
              attributes: expect.objectContaining({
                'exception.type': 'ApiError',
                'exception.message': expect.stringContaining(
                  'Gemini 404 NOT_FOUND',
                ) as string,
                'exception.stacktrace': expect.any(String) as string,
              }) as Record<string, string>,
            }),
          );
          expect(output.error_message).toContain('Gemini 404 NOT_FOUND');
          expect(output.error_code).toBe('NOT_FOUND');
          expect(span.attributes.error_causes).toContain('Dependency failed');
          expect(
            JSON.stringify([
              output,
              span.attributes,
              span.events,
              emit.mock.calls,
            ]),
          ).not.toContain('private');
          expect(
            JSON.stringify([
              output,
              span.attributes,
              span.events,
              emit.mock.calls,
            ]),
          ).not.toContain('alice@example.com');
        }
      },
    );

    if (kind === 'evaluation')
      it.each([0, 2])(
        'records an Err result at attempt %i without replacing the error',
        async (attemptsMade) => {
          const failure = new Error('Gemini 404 NOT_FOUND');
          await expect(fixture(attemptsMade, 3, 'err', failure)()).rejects.toBe(
            failure,
          );
          expect(emit.mock.calls[0][0].body).toBe('queue.job.failed');
          expect(emit.mock.calls[0][0].severityNumber).toBe(
            attemptsMade === 0 ? SeverityNumber.WARN : SeverityNumber.ERROR,
          );
          expect(exporter.getFinishedSpans()[0].events).toHaveLength(1);
        },
      );

    it('does not serialize a thrown object or replace it', async () => {
      const failure = { resume: 'private CV', password: 'private' };
      await expect(fixture(0, 3, 'throw', failure)()).rejects.toBe(failure);
      expect(
        JSON.stringify([
          write.mock.calls,
          emit.mock.calls,
          exporter.getFinishedSpans()[0].events,
        ]),
      ).not.toContain('private');
      expect(
        exporter.getFinishedSpans()[0].events[0].attributes?.['exception.type'],
      ).toBe('UnknownError');
    });

    it('preserves an Error whose cause getter throws and still emits one failure', async () => {
      const failure = new Error('Original failure');
      Object.defineProperty(failure, 'cause', {
        get: () => {
          throw new Error('Diagnostic failure');
        },
      });
      await expect(fixture(0, 3, 'throw', failure)()).rejects.toBe(failure);
      expect(write).toHaveBeenCalledTimes(1);
      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });

    it.each(['logger', 'metrics'] as const)(
      'preserves processing errors and ends spans if %s fails',
      async (sink) => {
        const failure = new Error('Original processing failure');
        if (sink === 'logger')
          jest
            .spyOn(StructuredLogger.prototype, 'job')
            .mockImplementation(() => {
              throw new Error('Telemetry failure');
            });
        else
          jest.spyOn(queueMetrics, 'attempt').mockImplementation(() => {
            throw new Error('Telemetry failure');
          });
        await expect(fixture(0, 3, 'throw', failure)()).rejects.toBe(failure);
        expect(exporter.getFinishedSpans()).toHaveLength(1);
        if (sink === 'metrics') expect(emit).toHaveBeenCalledTimes(1);
      },
    );
  },
);
