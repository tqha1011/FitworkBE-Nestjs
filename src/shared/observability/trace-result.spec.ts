import { err, ok } from 'neverthrow';
import { trace } from '@opentelemetry/api';
import { traceResult } from './trace-result';

describe('traceResult', () => {
  afterEach(() => jest.restoreAllMocks());

  it('ends the span and marks a returned Result.err', async () => {
    const span = {
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (...args: unknown[]) => {
        const callback = args[2] as (span: unknown) => Promise<unknown>;
        return callback(span);
      },
    } as never);

    const result = await traceResult('storage.get', () =>
      Promise.resolve(err(new Error('secret'))),
    );

    expect(result.isErr()).toBe(true);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('preserves a successful result', async () => {
    const result = await traceResult('storage.get', () =>
      Promise.resolve(ok('value')),
    );
    expect(result._unsafeUnwrap()).toBe('value');
  });
});
