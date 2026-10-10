import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { context, trace } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { StructuredLogger } from '../observability/structured-logger';
import { requestContext } from '../observability/request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const stored = requestContext.getStore();
    const header = response.getHeader('X-Request-ID');
    const requestId =
      stored?.requestId ?? (typeof header === 'string' ? header : randomUUID());
    if (!header) response.setHeader('X-Request-ID', requestId);
    const span = trace.getSpan(context.active())?.spanContext();
    const route = (request.route as { path?: unknown } | undefined)?.path;
    this.logger.httpFailure({
      exception,
      requestId,
      method: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
      ].includes(request.method)
        ? request.method
        : '_OTHER',
      route: typeof route === 'string' ? route : '_unmatched',
      statusCode: status,
      traceId: span?.traceId ?? stored?.traceId,
      spanId: span?.spanId ?? stored?.spanId,
    });

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        exception instanceof HttpException
          ? exception.message
          : 'Internal Server Error',
    });
  }
}
