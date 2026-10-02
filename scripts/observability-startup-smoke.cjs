// Run after npm run build. A real Nest HTTP fixture, without database/provider credentials.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');

async function child() {
  const sdkPath = path.resolve(__dirname, '../dist/src/instrumentation.js');
  for (const name of ['express', '@nestjs/core', 'pg', 'ioredis']) {
    assert.equal(require.cache[require.resolve(name)], undefined);
  }
  const { shutdownInstrumentation } = require(sdkPath);
  assert.equal(
    require(sdkPath).shutdownInstrumentation,
    shutdownInstrumentation,
  );
  const { createShutdown } = require('../dist/src/shutdown.js');
  const { Controller, Get, Module } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  const { trace, metrics } = require('@opentelemetry/api');
  const { logs } = require('@opentelemetry/api-logs');
  const http = require('node:http');
  const events = [];
  class HealthController {
    health() {
      const span = trace.getTracer('startup-smoke').startSpan('smoke.request');
      assert.equal(
        span.isRecording(),
        process.env.SMOKE_MODE === 'unavailable',
      );
      span.end();
      metrics.getMeter('startup-smoke').createCounter('smoke_requests').add(1);
      logs.getLogger('startup-smoke').emit({ body: 'smoke.request' });
      return { ok: true };
    }
  }
  Controller()(HealthController);
  Get('/health')(
    HealthController.prototype,
    'health',
    Object.getOwnPropertyDescriptor(HealthController.prototype, 'health'),
  );
  class Lifecycle {
    async onApplicationShutdown() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push('application.closed');
    }
  }
  class SmokeModule {}
  Module({ controllers: [HealthController], providers: [Lifecycle] })(
    SmokeModule,
  );
  const app = await NestFactory.create(SmokeModule, { logger: false });
  const shutdown = createShutdown(
    () => app.close(),
    async () => {
      assert.deepEqual(events, ['application.closed']);
      events.push('telemetry.shutdown');
      await shutdownInstrumentation();
    },
    (code) => {
      assert.deepEqual(events, ['application.closed', 'telemetry.shutdown']);
      // An unreachable exporter may reject shutdown; HTTP must still have succeeded.
      if (process.env.SMOKE_MODE !== 'unavailable') assert.equal(code, 0);
      console.log(
        `PASS ${process.env.SMOKE_MODE}: HTTP 200, one ordered shutdown (exit=${code})`,
      );
      process.exit(0);
    },
    3000,
  );
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${address.port}/health`, (response) => {
          assert.equal(response.statusCode, 200);
          let body = '';
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () => {
            assert.deepEqual(JSON.parse(body), { ok: true });
            resolve();
          });
        })
        .on('error', reject);
    });
  }
  process.emit('SIGTERM');
  process.emit('SIGINT');
  process.emit('SIGTERM');
}

async function main() {
  for (const mode of ['disabled', 'exporters-none', 'unavailable']) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('OTEL_') && key !== 'NODE_OPTIONS',
      ),
    );
    Object.assign(env, {
      SMOKE_MODE: mode,
      OTEL_SDK_DISABLED: String(mode === 'disabled'),
      OTEL_TRACES_EXPORTER: mode === 'exporters-none' ? 'none' : 'otlp',
      OTEL_METRICS_EXPORTER: mode === 'exporters-none' ? 'none' : 'otlp',
      OTEL_LOGS_EXPORTER: mode === 'exporters-none' ? 'none' : 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
      OTEL_EXPORTER_OTLP_TIMEOUT: '200',
      OTEL_METRIC_EXPORT_INTERVAL: '100',
      OTEL_BSP_SCHEDULE_DELAY: '50',
      OTEL_BLRP_SCHEDULE_DELAY: '50',
      OTEL_NODE_RESOURCE_DETECTORS: 'env',
      OTEL_NODE_ENABLED_INSTRUMENTATIONS: 'http,express,nestjs-core',
    });
    await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [__filename, '--child'], {
        cwd: tmpdir(),
        env,
        stdio: 'inherit',
      });
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`${mode}: timeout`));
      }, 10000);
      proc.on('error', reject);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`${mode}: exit ${code}`));
      });
    });
  }
}
const modeIsChild = process.argv.includes('--child');
(modeIsChild ? child() : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
