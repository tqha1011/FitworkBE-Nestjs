import { ConsoleLogger, Logger } from '@nestjs/common';
import { StructuredLogger } from './structured-logger';
import { logs, SeverityNumber, type LogRecord } from '@opentelemetry/api-logs';
import { requestContext } from './request-context';

describe('StructuredLogger', () => {
  afterEach(() => jest.restoreAllMocks());
  it('emits an allowlisted HTTP record without a raw URL or user data', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const logger = new StructuredLogger();

    logger.http({
      requestId: 'request-id',
      method: 'GET',
      route: '/api/resume/:id',
      statusCode: 200,
      durationMs: 12,
      traceId: 'trace-id',
      spanId: 'span-id',
    });

    const output = String(write.mock.calls[0][0]);
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        event: 'http.request.completed',
        request_id: 'request-id',
        route_template: '/api/resume/:id',
        status_class: '2xx',
      }),
    );
    expect(output).not.toContain('email');
    write.mockRestore();
  });

  it('preserves diagnostic messages while redacting PII and raw paths', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const logger = new StructuredLogger();

    logger.error(
      'Failed for alice@example.com at /resume/secret',
      'unsafe stack',
    );

    const output = String(write.mock.calls[0][0]);
    expect(output).toContain('app.error');
    expect(output).not.toContain('alice@example.com');
    expect(output).not.toContain('secret');
    expect(
      (JSON.parse(output) as Record<string, string>).error_message,
    ).toContain('Failed for');
    write.mockRestore();
  });

  it('emits sanitized errors to both stdout and OTLP with request context', () => {
    const emit = jest.fn<void, [LogRecord]>();
    jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const logger = new StructuredLogger();
    const failure = new Error(
      'Dependency failed for alice@example.com password="hunter2" token=abcdef phone=0912345678 at postgresql://user:pass@host/db',
    );
    failure.stack = `${failure.name}: ${failure.message}\n    at load (/app/job.service.js:10:2)`;
    requestContext.run({ requestId: 'req-123' }, () => logger.error(failure));

    const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
      string,
      string
    >;
    expect(output.error_message).toContain('Dependency failed');
    expect(output.error_stack).toContain('job.service.js:10:2');
    expect(output.request_id).toBe('req-123');
    expect(emit.mock.calls[0][0].severityNumber).toBe(SeverityNumber.ERROR);
    const both = JSON.stringify([output, emit.mock.calls]);
    for (const secret of [
      'alice@example.com',
      'hunter2',
      'abcdef',
      '0912345678',
      'user:pass',
    ]) {
      expect(both).not.toContain(secret);
    }
  });

  it('does not serialize arbitrary thrown objects', () => {
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    new StructuredLogger().error({ password: 'private', resume: 'private CV' });
    const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
      string,
      string
    >;
    expect(output.error_type).toBe('UnknownError');
    expect(JSON.stringify(output)).not.toContain('private');
  });

  it.each([
    ['cookie', 'session=private; auth=private'],
    ['authorization', 'Basic dXNlcjpwYXNz'],
  ])('redacts quoted %s headers on both logging sinks', (key, credential) => {
    const emit = jest.fn<void, [LogRecord]>();
    jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    new StructuredLogger().error(
      new Error(JSON.stringify({ [key]: credential })),
    );
    expect(JSON.stringify([write.mock.calls, emit.mock.calls])).not.toContain(
      credential,
    );
    expect(JSON.stringify([write.mock.calls, emit.mock.calls])).not.toContain(
      'private',
    );
  });
});

describe('HTTP failure diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('retains a bounded cause chain and safe Prisma metadata without query dumps', () => {
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const databaseError = Object.assign(
      new Error('SQL SELECT resume, password="private"'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2021',
        meta: { table: 'public.Job', resume: 'private CV' },
      },
    );
    const exception = new Error('Failed to search jobs', {
      cause: databaseError,
    });
    new StructuredLogger().httpFailure({
      requestId: 'req',
      method: 'GET',
      route: '/api/job',
      statusCode: 500,
      exception,
    });
    const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
      string,
      string
    >;
    expect(output.event).toBe('http.request.failed');
    expect(output.error_code).toBe('P2021');
    expect(output.error_message).toContain('public.Job');
    expect(JSON.parse(output.error_causes)).toHaveLength(2);
    expect(JSON.stringify(output)).not.toContain('SELECT');
    expect(JSON.stringify(output)).not.toContain('private');
  });

  it('bounds cyclic causes, long messages and stack frames', () => {
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const exception = new Error('x'.repeat(10000));
    exception.cause = exception;
    exception.stack =
      'Error: long\n' +
      Array.from(
        { length: 30 },
        (_, i) => `    at handler (/app/service.js:${i + 1}:1)`,
      ).join('\n');
    new StructuredLogger().httpFailure({
      requestId: 'req',
      method: 'GET',
      route: '/api/job',
      statusCode: 500,
      exception,
    });
    const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
      string,
      string
    >;
    expect(output.error_message.length).toBeLessThanOrEqual(2000);
    expect(output.error_stack.length).toBeLessThanOrEqual(8000);
    expect(output.error_stack.match(/at handler/g)).toHaveLength(20);
    expect(JSON.parse(output.error_causes)).toHaveLength(1);
  });

  it('logs client errors as warnings without stacks in any cause', () => {
    const emit = jest.fn<void, [LogRecord]>();
    jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    new StructuredLogger().httpFailure({
      requestId: 'req',
      method: 'GET',
      route: '/api/job',
      statusCode: 400,
      exception: new Error('Invalid request', { cause: new Error('detail') }),
    });
    expect(emit.mock.calls[0][0].severityNumber).toBe(SeverityNumber.WARN);
    const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
      string,
      string
    >;
    expect(output).not.toHaveProperty('error_stack');
    expect(output.error_causes).not.toContain('stack');
  });
});

describe('Nest logger error compatibility', () => {
  afterEach(() => {
    Logger.overrideLogger(new ConsoleLogger());
    jest.restoreAllMocks();
  });

  it.each(['error', 'message-error', 'message-stack'] as const)(
    'keeps Gemini 404 diagnostics on stdout and OTLP via Nest (%s)',
    (form) => {
      const emit = jest.fn<void, [LogRecord]>();
      jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
      const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
      Logger.overrideLogger(new StructuredLogger());
      const logger = new Logger('GeminiEvaluateApplicant');
      const root = Object.assign(
        new Error('Gemini 404 NOT_FOUND token=private alice@example.com'),
        { name: 'ApiError', code: 'NOT_FOUND' },
      );
      root.stack = `${root.name}: ${root.message}\n    at request (/app/gemini.js:20:4)`;
      const failure = new Error('Provider request failed', { cause: root });
      if (form === 'error') logger.error(failure);
      if (form === 'message-error') logger.error('Evaluation failed', failure);
      if (form === 'message-stack')
        logger.error('Evaluation failed', root.stack);
      const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
        string,
        string
      >;
      expect(write).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(output.error_message).toContain('Gemini 404 NOT_FOUND');
      expect(output.error_stack).toContain('gemini.js:20:4');
      expect(emit.mock.calls[0][0].attributes).toEqual(
        expect.objectContaining({
          error_message: output.error_message,
          error_stack: output.error_stack,
          error_causes: output.error_causes,
        }),
      );
      if (form === 'message-error') {
        expect(output.error_code).toBe('NOT_FOUND');
        expect(output.error_causes).toContain('Evaluation failed');
        expect(JSON.parse(output.error_causes)).toHaveLength(3);
      }
      const both = JSON.stringify([output, emit.mock.calls]);
      expect(both).not.toContain('private');
      expect(both).not.toContain('alice@example.com');
      expect(both).not.toContain('GeminiEvaluateApplicant');
    },
  );
});

describe('queue job outcome records', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([
    ['success', 1, 'queue.job.completed', SeverityNumber.INFO, false],
    ['error', 2, 'queue.job.failed', SeverityNumber.WARN, false],
    ['error', 3, 'queue.job.failed', SeverityNumber.ERROR, true],
  ] as const)(
    'emits %s attempt %i with correct severity and identifiers',
    (outcome, attempt, event, severity, finalAttempt) => {
      const emit = jest.fn<void, [LogRecord]>();
      jest.spyOn(logs, 'getLogger').mockReturnValue({ emit });
      const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
      const record = {
        requestId: 'request-123',
        queue: 'llm-evaluation',
        jobId: 'job-123',
        evaluationPublicId: 'evaluation-123',
        attempt,
        maxAttempts: 3,
        outcome,
        durationMs: 20,
        traceId: 'trace-123',
        spanId: 'span-123',
        exception: new Error('Gemini request failed', {
          cause: new Error('Gemini 404 NOT_FOUND'),
        }),
      };
      new StructuredLogger().job(record);
      const output = JSON.parse(String(write.mock.calls[0][0])) as Record<
        string,
        unknown
      >;
      expect(output).toEqual(
        expect.objectContaining({
          event,
          job_id: 'job-123',
          evaluation_public_id: 'evaluation-123',
          request_id: 'request-123',
          attempt,
          max_attempts: 3,
          final_attempt: finalAttempt,
          outcome,
          duration_ms: 20,
          trace_id: 'trace-123',
          span_id: 'span-123',
        }),
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.calls[0][0].severityNumber).toBe(severity);
      if (outcome === 'error') expect(output.error_message).toContain('404');
      else expect(output).not.toHaveProperty('error_message');
    },
  );
});
