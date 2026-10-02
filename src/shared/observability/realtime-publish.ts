import { SpanStatusCode, trace } from '@opentelemetry/api';

export function publishRealtime(action: () => void): void {
  trace
    .getTracer('fitwork.realtime')
    .startActiveSpan('realtime.publish', (span) => {
      try {
        action();
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
}
