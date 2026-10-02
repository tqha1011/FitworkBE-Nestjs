import { EventEmitter } from 'node:events';
import { Request, Response } from 'express';
import { LoggerMiddleware } from './logger.middleware';
import { StructuredLogger } from '../observability/structured-logger';
import { metrics } from '@opentelemetry/api';

describe('LoggerMiddleware', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates a request ID and logs the matched route once', () => {
    const http = jest.fn();
    const logger = { http } as unknown as StructuredLogger;
    const middleware = new LoggerMiddleware(logger);
    const response = new EventEmitter() as Response;
    const setHeader = jest.fn();
    response.setHeader = setHeader;
    response.statusCode = 200;
    const request = {
      method: 'GET',
      originalUrl: '/api/resume/private?token=secret',
      route: { path: '/api/resume/:id' },
    } as Request;
    const next = jest.fn();

    middleware.use(request, response, next);
    response.emit('finish');
    response.emit('close');

    expect(next).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/resume/:id', statusCode: 200 }),
    );
    expect(JSON.stringify(http.mock.calls)).not.toContain('secret');
  });

  it('records HTTP metrics with a route template and no request ID label', () => {
    const add = jest.fn();
    const record = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn().mockReturnValue({ add }),
      createHistogram: jest.fn().mockReturnValue({ record }),
    } as never);
    const middleware = new LoggerMiddleware({ http: jest.fn() } as never);
    const response = new EventEmitter() as Response;
    response.setHeader = jest.fn();
    response.statusCode = 500;
    const request = {
      method: 'GET',
      route: { path: '/api/resume/:id' },
    } as Request;

    middleware.use(request, response, jest.fn());
    response.emit('finish');

    expect(add).toHaveBeenCalledWith(1, {
      method: 'GET',
      route: '/api/resume/:id',
      status_class: '5xx',
    });
    expect(record).toHaveBeenCalledWith(expect.any(Number), {
      method: 'GET',
      route: '/api/resume/:id',
      status_class: '5xx',
    });
    expect(JSON.stringify(add.mock.calls)).not.toContain('request_id');
  });
});
