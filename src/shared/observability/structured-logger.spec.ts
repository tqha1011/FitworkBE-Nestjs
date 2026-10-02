import { StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
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

  it('drops arbitrary Nest log messages that may contain PII', () => {
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
    write.mockRestore();
  });
});
