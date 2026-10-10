import { trace } from '@opentelemetry/api';

describe('OpenTelemetry bootstrap', () => {
  it('registers a recording tracer when tracing is enabled', async () => {
    const names = [
      'OTEL_SERVICE_NAME',
      'OTEL_EXPORTER_OTLP_PROTOCOL',
      'OTEL_TRACES_EXPORTER',
      'OTEL_METRICS_EXPORTER',
      'OTEL_METRIC_EXPORT_INTERVAL',
      'OTEL_LOGS_EXPORTER',
      'OTEL_NODE_RESOURCE_DETECTORS',
      'OTEL_NODE_ENABLED_INSTRUMENTATIONS',
      'OTEL_SDK_DISABLED',
    ] as const;
    const previous = names.map((name) => process.env[name]);

    process.env.OTEL_TRACES_EXPORTER = 'console';
    process.env.OTEL_METRICS_EXPORTER = 'none';
    process.env.OTEL_LOGS_EXPORTER = 'none';
    process.env.OTEL_NODE_RESOURCE_DETECTORS = 'env';
    process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = 'http';
    process.env.OTEL_SDK_DISABLED = 'false';

    const { shutdownInstrumentation } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./instrumentation') as typeof import('./instrumentation');
    try {
      const span = trace
        .getTracer('bootstrap-test')
        .startSpan('bootstrap-smoke');
      expect(span.isRecording()).toBe(true);
      span.end();
    } finally {
      await shutdownInstrumentation();
      names.forEach((name, index) => {
        const value = previous[index];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      });
    }
  });
});
