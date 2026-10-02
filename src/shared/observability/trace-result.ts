import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { Result } from 'neverthrow';

export function traceResult<T, E>(
  name: string,
  operation: () => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  return trace
    .getTracer('fitwork.dependencies')
    .startActiveSpan(name, { kind: SpanKind.CLIENT }, async (span) => {
      try {
        const result = await operation();
        span.setStatus({
          code: result.isErr() ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
}
