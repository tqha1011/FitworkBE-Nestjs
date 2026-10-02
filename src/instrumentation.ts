import { existsSync } from 'node:fs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Start the SDK before Nest and its dependencies are imported.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

if (!process.env.OTEL_SERVICE_NAME) {
  process.env.OTEL_SERVICE_NAME = 'fitwork-nestjs-api';
}
process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??= 'grpc';
process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
process.env.OTEL_METRICS_EXPORTER ??= 'otlp';
process.env.OTEL_LOGS_EXPORTER ??= 'otlp';
process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ??=
  'http,express,nestjs-core,pg,ioredis,redis,undici,runtime-node';

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

let shutdownPromise: Promise<void> | undefined;

export function shutdownInstrumentation(): Promise<void> {
  shutdownPromise ??= sdk.shutdown();
  return shutdownPromise;
}

function handleShutdown(): void {
  setTimeout(() => process.exit(1), 5_000);
  void shutdownInstrumentation()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

process.once('SIGTERM', handleShutdown);
process.once('SIGINT', handleShutdown);
