import { SpanStatusCode, trace } from '@opentelemetry/api';
import { publishRealtime } from './realtime-publish';

describe('publishRealtime', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ends an error span and rethrows an emit failure', () => {
    const span = { setStatus: jest.fn(), end: jest.fn() };
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (...args: unknown[]) => {
        const callback = args[1] as (span: unknown) => unknown;
        return callback(span);
      },
    } as never);

    expect(() =>
      publishRealtime(() => {
        throw new Error('failed');
      }),
    ).toThrow('failed');
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
