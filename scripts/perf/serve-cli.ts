// Optional development API launcher with the application's real cache metrics.
// No REST endpoints or schema are added. Keeps metric collection out of HTTP requests.
import 'dotenv/config';
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { metrics } from '@opentelemetry/api';
import {
  DataPointType,
  MeterProvider,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { Pool } from 'pg';
import { inspectDatabase, requiredEnv } from './database';
import { CacheMetrics } from './metrics';

class FileCacheMetricReader extends MetricReader {
  private readonly timer: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {
    super();
    this.timer = setInterval(() => {
      void this.flush().catch((error: unknown) =>
        console.error('Cache metric snapshot failed', error),
      );
    }, 1000);
    this.timer.unref();
  }
  private flush(): Promise<void> {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        const { resourceMetrics } = await this.collect();
        const cache: CacheMetrics = { hit: 0, miss: 0, error: 0 };
        for (const scope of resourceMetrics.scopeMetrics) {
          for (const metric of scope.metrics) {
            if (
              metric.descriptor.name !== 'fitwork_cache_accesses_total' ||
              metric.dataPointType !== DataPointType.SUM
            )
              continue;
            for (const point of metric.dataPoints) {
              if (point.attributes.cache_group !== 'reference_skills') continue;
              const result = point.attributes.result;
              if (result === 'hit' || result === 'miss' || result === 'error')
                cache[result] += point.value;
            }
          }
        }
        const temp = `${this.path}.tmp`;
        await writeFile(
          temp,
          JSON.stringify({
            collectedAt: new Date().toISOString(),
            pid: process.pid,
            cache,
          }) + '\n',
        );
        await rename(temp, this.path);
      });
    return this.pending;
  }
  protected async onForceFlush() {
    await this.flush();
  }
  protected async onShutdown() {
    clearInterval(this.timer);
    await this.pending;
  }
}

async function main() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const redisUrl = requiredEnv('REDIS_URL');
  const path = resolve(
    process.env.CACHE_METRICS_FILE ?? '.tmp/job-benchmark/cache-metrics.json',
  );
  await mkdir(resolve(path, '..'), { recursive: true });
  const reader = new FileCacheMetricReader(path);
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  // Import after registering metrics so application counters bind to this provider.
  const { AppModule } = await import('../../src/app.module.js');
  const { StructuredLogger } =
    await import('../../src/shared/observability/structured-logger.js');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(StructuredLogger));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  const port = Number(process.env.PORT ?? 3010);
  await app.listen(port, '127.0.0.1');
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await writeFile(
      resolve(path, '..', 'api-evidence.json'),
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          apiBaseUrl: `http://127.0.0.1:${port}`,
          database: await inspectDatabase(pool),
          redisFingerprint: createHash('sha256').update(redisUrl).digest('hex'),
          observability:
            'Application counters exported to a local file; no automatic trace/log exporter. Otherwise the real AppModule, controllers, guards, services and adapters.',
        },
        null,
        2,
      ) + '\n',
    );
    await provider.forceFlush();
    console.log(
      `Benchmark API: http://127.0.0.1:${port}; cache metrics: ${path}`,
    );
  } finally {
    await pool.end();
  }
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await provider.forceFlush();
    await provider.shutdown();
  };
  process.on('SIGINT', () => {
    void close().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void close().then(() => process.exit(0));
  });
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Benchmark API startup failed',
  );
  process.exit(1);
});
