import { Injectable, LoggerService } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { Attributes, context, trace } from '@opentelemetry/api';
import { errorDiagnostics } from './error-diagnostics';
import { requestContext } from './request-context';

type HttpRecord = {
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  traceId?: string;
  spanId?: string;
};

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly otel = logs.getLogger('fitwork.application');

  log(_message: unknown): void {
    void _message;
    this.write('app.log', SeverityNumber.INFO, {});
  }

  error(message: unknown, stack?: unknown): void {
    if (typeof message === 'string' && stack instanceof Error) {
      message = new Error(message, { cause: stack });
    } else if (
      typeof message === 'string' &&
      typeof stack === 'string' &&
      /^\s*at\s/m.test(stack)
    ) {
      const header = stack.split(/\r?\n/, 1)[0];
      const match = /^([A-Za-z_][A-Za-z0-9_.-]{0,127}):\s*(.*)$/.exec(header);
      const exception = new Error(match?.[2] || message);
      if (match) exception.name = match[1];
      exception.stack = stack;
      message = new Error(message, { cause: exception });
    }
    this.write('app.error', SeverityNumber.ERROR, errorDiagnostics(message));
  }

  warn(_message: unknown): void {
    void _message;
    this.write('app.warn', SeverityNumber.WARN, {});
  }

  debug(_message: unknown): void {
    void _message;
    this.write('app.debug', SeverityNumber.DEBUG, {});
  }

  verbose(_message: unknown): void {
    void _message;
    this.write('app.verbose', SeverityNumber.TRACE, {});
  }

  fatal(_message: unknown): void {
    void _message;
    this.write('app.fatal', SeverityNumber.FATAL, {});
  }

  http(record: HttpRecord): void {
    const fields = {
      request_id: record.requestId,
      trace_id: record.traceId ?? '',
      span_id: record.spanId ?? '',
      method: record.method,
      route_template: record.route,
      status_code: record.statusCode,
      status_class: `${Math.floor(record.statusCode / 100)}xx`,
      duration_ms: record.durationMs,
    };
    this.write(
      'http.request.completed',
      record.statusCode >= 500
        ? SeverityNumber.ERROR
        : record.statusCode >= 400
          ? SeverityNumber.WARN
          : SeverityNumber.INFO,
      fields,
    );
  }

  httpFailure(
    record: Omit<HttpRecord, 'durationMs'> & { exception: unknown },
  ): void {
    this.write(
      'http.request.failed',
      record.statusCode >= 500 ? SeverityNumber.ERROR : SeverityNumber.WARN,
      {
        request_id: record.requestId,
        trace_id: record.traceId ?? '',
        span_id: record.spanId ?? '',
        method: record.method,
        route_template: record.route,
        status_code: record.statusCode,
        status_class: `${Math.floor(record.statusCode / 100)}xx`,
        ...errorDiagnostics(record.exception, record.statusCode >= 500),
      },
    );
  }

  job(record: {
    requestId: string;
    queue: string;
    jobId?: string;
    evaluationPublicId?: string;
    resumePublicId?: string;
    resumeContentPublicId?: string;
    attempt: number;
    maxAttempts: number;
    outcome: 'success' | 'error';
    durationMs: number;
    traceId?: string;
    spanId?: string;
    exception?: unknown;
  }): void {
    const finalAttempt = record.attempt >= record.maxAttempts;
    this.write(
      record.outcome === 'success' ? 'queue.job.completed' : 'queue.job.failed',
      record.outcome === 'success'
        ? SeverityNumber.INFO
        : finalAttempt
          ? SeverityNumber.ERROR
          : SeverityNumber.WARN,
      {
        request_id: record.requestId,
        queue: record.queue,
        job_id: record.jobId ?? '',
        ...(record.evaluationPublicId
          ? { evaluation_public_id: record.evaluationPublicId }
          : {}),
        ...(record.resumePublicId
          ? { resume_public_id: record.resumePublicId }
          : {}),
        ...(record.resumeContentPublicId
          ? { resume_content_public_id: record.resumeContentPublicId }
          : {}),
        attempt: record.attempt,
        max_attempts: record.maxAttempts,
        final_attempt: finalAttempt,
        outcome: record.outcome,
        duration_ms: record.durationMs,
        trace_id: record.traceId ?? '',
        span_id: record.spanId ?? '',
        ...(record.outcome === 'error'
          ? errorDiagnostics(record.exception)
          : {}),
      },
    );
  }

  private write(
    event: string,
    severityNumber: SeverityNumber,
    fields: Attributes,
  ): void {
    const stored = requestContext.getStore();
    const span =
      trace.getSpan(context.active())?.spanContext() ??
      (stored?.traceId
        ? { traceId: stored.traceId, spanId: stored.spanId ?? '' }
        : undefined);
    fields = {
      ...(stored?.requestId ? { request_id: stored.requestId } : {}),
      ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}),
      ...fields,
    };
    const payload = {
      timestamp: new Date().toISOString(),
      event,
      severity_text: SeverityNumber[severityNumber],
      ...fields,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    this.otel.emit({
      body: event,
      severityNumber,
      severityText: SeverityNumber[severityNumber],
      attributes: { 'event.domain': 'fitwork', 'event.name': event, ...fields },
    });
  }
}
