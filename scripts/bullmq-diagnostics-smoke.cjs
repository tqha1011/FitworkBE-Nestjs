// Run after npm run build against the local monitoring stack. No real queue or Gemini calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

async function main() {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  process.env.NODE_PATH = path.resolve(__dirname, '../dist');
  Module.Module._initPaths();
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const {
    OTLPTraceExporter,
  } = require('@opentelemetry/exporter-trace-otlp-grpc');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc');
  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
  const {
    OTLPMetricExporter,
  } = require('@opentelemetry/exporter-metrics-otlp-grpc');
  const {
    PeriodicExportingMetricReader,
  } = require('@opentelemetry/sdk-metrics');
  const endpoint = `http://127.0.0.1:${process.env.OTEL_PORT || 4317}`;
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: endpoint }),
    exportIntervalMillis: 60000,
  });
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': 'fitwork-diagnostics-smoke',
    }),
    resourceDetectors: [],
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: endpoint }),
      }),
    ],
    metricReaders: [metricReader],
    instrumentations: [],
  });
  sdk.start();
  const { trace } = require('@opentelemetry/api');
  const { Logger } = require('@nestjs/common');
  const { err } = require('neverthrow');
  const {
    StructuredLogger,
  } = require('../dist/src/shared/observability/structured-logger.js');
  const {
    ApplicantEvaluationProcessor,
  } = require('../dist/src/modules/applicant-evaluation/infrastructure/applicant-evaluation.processor.js');
  const {
    ResumeIngestionProcessor,
  } = require('../dist/src/modules/resume/infrastructure/resume-ingestion.processor.js');
  const {
    GeminiEvaluateApplicant,
  } = require('../dist/src/modules/applicant-evaluation/infrastructure/llm/providers/applicant-evaluation-gemini.js');
  const records = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = function (chunk, ...args) {
    try {
      const record = JSON.parse(String(chunk));
      if (record.event) records.push(record);
    } catch {
      /* Non-JSON SDK output is not an application event. */
    }
    return originalWrite.call(this, chunk, ...args);
  };
  const stamp = Date.now();
  const evaluationPublicId = `smoke-evaluation-${stamp}`;
  const resumePublicId = `smoke-resume-${stamp}`;
  const requestId = `smoke-request-${stamp}`;
  const failure = Object.assign(
    new Error('Gemini 404 NOT_FOUND token=smoke-secret alice@example.com'),
    {
      name: 'ApiError',
      code: 'NOT_FOUND',
    },
  );
  const provider = new GeminiEvaluateApplicant({
    getOrThrow: () => 'fake-key-never-sent',
  });
  provider.client.models.generateContent = async () => {
    throw failure;
  };
  const input = {
    model: 'fake-gemini-404',
    promptVersion: 'applicant-match-v1',
    resumeText: 'Synthetic TypeScript experience',
    jobSnapshot: {
      schemaVersion: 1,
      publicId: 'fake-job',
      title: 'Engineer',
      description: 'Synthetic job',
      requirements: 'TypeScript',
      location: 'Remote',
      skills: [],
      category: null,
      arrangement: null,
    },
  };
  const logger = new StructuredLogger();
  Logger.overrideLogger(logger);
  const evaluation = new ApplicantEvaluationProcessor({
    process: async () => {
      const result = await provider.evaluate(input);
      assert.equal(result.isErr(), true);
      return err(
        new Error('Evaluation dependency failed', { cause: result.error }),
      );
    },
  });
  const ingestionError = new Error('Resume dependency failed', {
    cause: failure,
  });
  const resume = new ResumeIngestionProcessor({
    ingest: async () => {
      throw ingestionError;
    },
  });
  try {
    for (const attemptsMade of [0, 2]) {
      await assert.rejects(
        evaluation.process({
          id: `eval-job-${stamp}`,
          opts: { attempts: 3 },
          attemptsMade,
          data: { evaluationPublicId, telemetry: { requestId } },
        }),
        (error) => error.cause === failure,
      );
      await assert.rejects(
        resume.process({
          id: `resume-job-${stamp}`,
          opts: { attempts: 3 },
          attemptsMade,
          data: {
            resumePublicId,
            resumeContentPublicId: `smoke-content-${stamp}`,
            telemetry: { requestId },
          },
        }),
        (error) => error === ingestionError,
      );
    }
    trace
      .getTracer('smoke.http')
      .startActiveSpan('smoke.http.failure', (span) => {
        const { traceId, spanId } = span.spanContext();
        logger.httpFailure({
          requestId,
          traceId,
          spanId,
          method: 'GET',
          route: '/api/smoke/:id',
          statusCode: 500,
          exception: new Error('Synthetic HTTP dependency failure'),
        });
        span.end();
      });
    const queueRecords = records.filter((record) => record.queue);
    assert.equal(queueRecords.length, 4);
    assert.equal(
      records.some((record) => record.event === 'queue.job.completed'),
      false,
    );
    assert.deepEqual(
      queueRecords.map((record) => record.severity_text),
      ['WARN', 'WARN', 'ERROR', 'ERROR'],
    );
    assert.equal(JSON.stringify(records).includes('smoke-secret'), false);
    assert.equal(JSON.stringify(records).includes('alice@example.com'), false);
    await metricReader.forceFlush();
  } finally {
    process.stdout.write = originalWrite;
    await sdk.shutdown();
  }

  const grafana = `http://127.0.0.1:${process.env.GRAFANA_PORT || 3001}`;
  const jaeger = `http://127.0.0.1:${process.env.JAEGER_PORT || 16686}`;
  const prometheus = `http://127.0.0.1:${process.env.PROMETHEUS_PORT || 9090}`;
  const auth = `Basic ${Buffer.from(`${process.env.GRAFANA_ADMIN_USER || 'admin'}:${process.env.GRAFANA_ADMIN_PASSWORD || 'admin'}`).toString('base64')}`;
  async function getJson(url) {
    const response = await fetch(url, {
      headers: url.startsWith(grafana) ? { Authorization: auth } : {},
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(
      response.ok,
      true,
      `HTTP ${response.status}: ${new URL(url).pathname}`,
    );
    return response.json();
  }
  async function eventually(check) {
    const deadline = Date.now() + 45000;
    let lastError;
    do {
      try {
        return await check();
      } catch (error) {
        lastError = error;
        if (/HTTP (401|403)/.test(String(error))) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    throw lastError;
  }
  const expectedDashboard = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../src/monitoring/grafana/dashboards/fitwork-logs.json',
      ),
      'utf8',
    ),
  );
  console.log('smoke: verifying provisioned Grafana dashboard');
  const dashboard = await eventually(async () => {
    const result = await getJson(`${grafana}/api/dashboards/uid/fitwork-logs`);
    const panel = result.dashboard.panels.find(
      (item) => item.title === 'Error details',
    );
    assert.equal(
      panel.targets[0].expr,
      expectedDashboard.panels.find((item) => item.title === 'Error details')
        .targets[0].expr,
    );
    return result.dashboard;
  });
  assert.equal(dashboard.uid, expectedDashboard.uid);
  assert.equal(
    dashboard.panels.find((item) => item.title === 'Error details').targets[0]
      .expr,
    expectedDashboard.panels.find((item) => item.title === 'Error details')
      .targets[0].expr,
  );
  const datasources = await getJson(`${grafana}/api/datasources`);
  const loki = datasources.find((item) => item.name === 'Loki');
  assert.ok(loki);
  async function queryLoki(query) {
    const params = new URLSearchParams({
      query,
      start: String((stamp - 60000) * 1000000),
      end: String(Date.now() * 1000000),
      limit: '100',
    });
    const result = await getJson(
      `${grafana}/api/datasources/proxy/uid/${encodeURIComponent(loki.uid)}/loki/api/v1/query_range?${params}`,
    );
    assert.equal(result.status, 'success');
    return result.data.result;
  }
  const errorExpr = dashboard.panels.find(
    (item) => item.title === 'Error details',
  ).targets[0].expr;
  console.log('smoke: querying queue failures via Grafana Loki datasource');
  const raw = await eventually(async () => {
    const streams = await queryLoki(
      `{event_domain="fitwork",event_name="queue.job.failed"} |= ${JSON.stringify(evaluationPublicId)}`,
    );
    assert.equal(streams.flatMap((stream) => stream.values).length, 2);
    return streams;
  });
  for (const stream of raw) {
    assert.equal(
      Object.keys(stream.stream).some((key) => /public_id|job_id/.test(key)),
      false,
    );
    for (const [, line] of stream.values) {
      const attributes = JSON.parse(line).attributes;
      assert.equal(attributes.evaluation_public_id, evaluationPublicId);
      assert.equal(attributes.error_code, 'NOT_FOUND');
      assert.match(attributes.error_message, /404 NOT_FOUND/);
      assert.ok(attributes.error_stack);
      assert.ok(JSON.parse(attributes.error_causes).length >= 2);
    }
  }
  for (const publicId of [evaluationPublicId, resumePublicId]) {
    const formatted = await queryLoki(
      errorExpr.replace('${search:doublequote}', JSON.stringify(publicId)),
    );
    const lines = formatted.flatMap((stream) =>
      stream.values.map(([, line]) => line),
    );
    assert.equal(lines.length, 2);
    assert.ok(
      lines.some((line) => line.includes('attempt=1/3 final_attempt=false')),
    );
    assert.ok(
      lines.some((line) => line.includes('attempt=3/3 final_attempt=true')),
    );
    assert.ok(lines.every((line) => line.includes('404 NOT_FOUND')));
  }
  const httpLines = await queryLoki(
    errorExpr.replace(
      '${search:doublequote}',
      JSON.stringify('/api/smoke/:id'),
    ),
  );
  assert.ok(
    httpLines
      .flatMap((stream) => stream.values)
      .some(([, line]) => line.includes('GET /api/smoke/:id 500')),
  );
  const appLines = await queryLoki(
    errorExpr.replace(
      '${search:doublequote}',
      JSON.stringify('Failed to evaluate applicant with Gemini'),
    ),
  );
  assert.ok(
    appLines
      .flatMap((stream) => stream.values)
      .some(([, line]) =>
        line.includes('app.error | ApiError: Gemini 404 NOT_FOUND'),
      ),
  );
  const completed = await queryLoki(
    `{event_domain="fitwork",event_name="queue.job.completed"} |= ${JSON.stringify(requestId)}`,
  );
  assert.equal(completed.length, 0);
  const queueRecords = records.filter((record) => record.queue);
  console.log('smoke: verifying Jaeger queue and Gemini spans');
  for (const record of queueRecords) {
    await eventually(async () => {
      const result = await getJson(`${jaeger}/api/traces/${record.trace_id}`);
      const spans = result.data[0].spans;
      const span = spans.find((item) => item.spanID === record.span_id);
      assert.ok(span);
      assert.ok(
        span.tags.some(
          (tag) => tag.key === 'job_id' && tag.value === record.job_id,
        ),
      );
      assert.ok(span.tags.some((tag) => tag.key === 'error_causes'));
      assert.ok(
        span.logs.some((log) =>
          log.fields.some(
            (field) =>
              field.key === 'exception.message' &&
              field.value.includes('404 NOT_FOUND'),
          ),
        ),
      );
      if (record.evaluation_public_id) {
        const child = spans.find(
          (item) => item.operationName === 'evaluation.llm.evaluate',
        );
        assert.ok(child);
        assert.ok(
          child.logs.some((log) =>
            log.fields.some(
              (field) =>
                field.key === 'exception.message' &&
                field.value.includes('404 NOT_FOUND'),
            ),
          ),
        );
      }
      assert.equal(JSON.stringify(spans).includes('smoke-secret'), false);
    });
  }
  console.log('smoke: verifying metric labels');
  const series = await eventually(async () => {
    const params = new URLSearchParams({
      'match[]': '{service_name="fitwork-diagnostics-smoke"}',
      start: String(stamp / 1000 - 60),
    });
    const result = await getJson(`${prometheus}/api/v1/series?${params}`);
    assert.ok(result.data.length);
    return result.data;
  });
  assert.equal(
    series.some((labels) =>
      Object.keys(labels).some((key) => /public_id|job_id/.test(key)),
    ),
    false,
  );
  assert.equal(JSON.stringify(series).includes(evaluationPublicId), false);
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        evaluationPublicId,
        resumePublicId,
        grafana: `${grafana}/d/fitwork-logs?var-search=${evaluationPublicId}`,
        traces: queueRecords.map(
          (record) => `${jaeger}/trace/${record.trace_id}`,
        ),
        checks:
          'Grafana provisioned query, 404 cause/stack, retry/final, resume, HTTP/app errors, Jaeger queue/Gemini exceptions, no ID labels',
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
