import { Span, SpanStatusCode } from '@opentelemetry/api';
import { errorDiagnostics } from './error-diagnostics';

/** Telemetry must never alter the processing result or prevent span cleanup. */
export function bestEffortTelemetry(operation: () => void): void {
  try {
    operation();
  } catch {
    // Reporting a telemetry failure through the same sink could fail recursively.
  }
}

export function recordSpanError(span: Span, error: unknown): void {
  const diagnostics = errorDiagnostics(error);
  bestEffortTelemetry(() => span.setStatus({ code: SpanStatusCode.ERROR }));
  bestEffortTelemetry(() => span.setAttributes(diagnostics));
  bestEffortTelemetry(() =>
    span.recordException({
      name: diagnostics.error_type,
      message: diagnostics.error_message,
      stack: diagnostics.error_stack,
    }),
  );
}
