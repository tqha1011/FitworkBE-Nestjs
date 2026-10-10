import {
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import request from 'supertest';
import type { Server } from 'node:http';
import { AllExceptionsFilter } from './exceptions.filter';
import { StructuredLogger } from '../observability/structured-logger';
import { LoggerMiddleware } from './logger.middleware';

@Controller('/api/failure')
class FailureController {
  @Get('server/:id')
  server() {
    throw new InternalServerErrorException('Failed to search jobs', {
      cause: new Error(
        'database unavailable for alice@example.com password=hunter2',
      ),
    });
  }

  @Get('client')
  client() {
    throw new BadRequestException('Invalid request');
  }
}

describe('HTTP exception logging', () => {
  let app: INestApplication;
  let records: Record<string, unknown>[];

  beforeEach(async () => {
    records = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((data) => {
      try {
        records.push(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        /* Nest startup output */
      }
      return true;
    });
    const module = await Test.createTestingModule({
      controllers: [FailureController],
      providers: [
        StructuredLogger,
        LoggerMiddleware,
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    const middleware = app.get(LoggerMiddleware);
    app.use(middleware.use.bind(middleware));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('logs the error and completion once with the same request ID and route template', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/failure/server/private-id?token=secret')
      .expect(500);
    const failures = records.filter((r) => r.event === 'http.request.failed');
    const completions = records.filter(
      (r) => r.event === 'http.request.completed',
    );
    expect(failures).toHaveLength(1);
    expect(completions).toHaveLength(1);
    expect(failures[0]).toEqual(
      expect.objectContaining({
        request_id: response.headers['x-request-id'],
        route_template: '/api/failure/server/:id',
        status_code: 500,
      }),
    );
    expect(failures[0].error_message).toEqual(
      expect.stringContaining('database unavailable'),
    );
    expect(failures[0].error_stack).toEqual(
      expect.stringContaining('FailureController.server'),
    );
    expect(completions[0].request_id).toBe(failures[0].request_id);
    expect((response.body as { message: string }).message).toBe(
      'Failed to search jobs',
    );
    expect(JSON.stringify(response.body)).not.toContain('database unavailable');
    for (const secret of [
      'alice@example.com',
      'hunter2',
      'private-id',
      'token=secret',
    ]) {
      expect(JSON.stringify(records)).not.toContain(secret);
    }
  });

  it('keeps the 4xx response without leaking a stack into the log', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/failure/client')
      .expect(400);
    expect((response.body as { message: string }).message).toBe(
      'Invalid request',
    );
    const failure = records.find((r) => r.event === 'http.request.failed');
    expect(failure).toEqual(
      expect.objectContaining({
        status_code: 400,
        error_message: 'Invalid request',
      }),
    );
    expect(failure).not.toHaveProperty('error_stack');
  });
});
