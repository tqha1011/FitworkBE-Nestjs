import { randomUUID } from 'node:crypto';
import { context, metrics, trace } from '@opentelemetry/api';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { StructuredLogger } from '../observability/structured-logger';
import { requestContext } from '../observability/request-context';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly meter = metrics.getMeter('fitwork.http');
  private readonly requests = this.meter.createCounter(
    'fitwork_http_requests_total',
  );
  private readonly errors = this.meter.createCounter(
    'fitwork_http_errors_total',
  );
  private readonly duration = this.meter.createHistogram(
    'fitwork_http_request_duration_seconds',
    { unit: 's' },
  );

  constructor(private readonly logger: StructuredLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    const start = performance.now();
    const initialSpan = trace.getSpan(context.active());
    let completed = false;
    const finish = (aborted: boolean) => {
      if (completed) return;
      completed = true;
      const activeSpan = trace.getSpan(context.active()) ?? initialSpan;
      const spanContext = activeSpan?.spanContext();
      const route = (req.route as { path?: unknown } | undefined)?.path;
      const method = [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
      ].includes(req.method)
        ? req.method
        : '_OTHER';
      const routeTemplate = typeof route === 'string' ? route : '_unmatched';
      const statusCode = aborted ? 499 : res.statusCode;
      const durationMs = Math.round(performance.now() - start);
      const labels = {
        method,
        route: routeTemplate,
        status_class: `${Math.floor(statusCode / 100)}xx`,
      };
      this.requests.add(1, labels);
      if (statusCode >= 400) this.errors.add(1, labels);
      this.duration.record(durationMs / 1000, labels);
      this.logger.http({
        requestId,
        method,
        route: routeTemplate,
        statusCode,
        durationMs,
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
      });
    };
    res.once('finish', () => finish(false));
    res.once('close', () => finish(true));

    requestContext.run({ requestId }, next);
  }
}
