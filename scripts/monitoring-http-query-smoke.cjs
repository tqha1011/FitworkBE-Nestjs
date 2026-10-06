// Test the provisioned dashboard query with Prometheus's real PromQL engine.
// Run with the Compose Prometheus service up: node scripts/monitoring-http-query-smoke.cjs
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const dashboard = require('../src/monitoring/grafana/dashboards/fitwork-metrics.json');

const panel = dashboard.panels.find((item) => item.id === 2);
assert.ok(panel, 'HTTP 5xx panel must exist');
const expression = panel.targets[0].expr
  .replaceAll('${service:regex}', 'fitwork-nestjs-api')
  .replaceAll('$__rate_interval', '1m');
const requests = {
  series:
    'fitwork_http_requests_total{service_name="fitwork-nestjs-api",method="GET",route="/api/categories",status_class="2xx"}',
  values: '0+10x4',
};
const errors = {
  series:
    'fitwork_http_errors_total{service_name="fitwork-nestjs-api",method="GET",route="/api/categories",status_class="5xx"}',
  values: '0+1x4',
};
const cases = [
  {
    name: 'traffic without an error series returns zero',
    series: [requests],
    expected: 0,
  },
  {
    name: 'traffic with 5xx returns the error fraction',
    series: [
      { ...requests, values: '0+3x4' },
      { series: requests.series.replace('2xx', '5xx'), values: '0+1x4' },
      errors,
    ],
    expected: 0.25,
  },
  {
    name: 'traffic with a zero error counter returns zero',
    series: [requests, { ...errors, values: '0+0x4' }],
    expected: 0,
  },
  {
    name: 'idle counters return no data',
    series: [
      { ...requests, values: '10+0x4' },
      { ...errors, values: '1+0x4' },
    ],
  },
  { name: 'missing telemetry returns no data', series: [] },
  { name: 'errors without request telemetry return no data', series: [errors] },
];
const fixtures = {
  evaluation_interval: '15s',
  tests: cases.map(({ name, series, expected }) => ({
    name,
    interval: '15s',
    input_series: series,
    promql_expr_test: [
      {
        expr: expression,
        eval_time: '1m',
        exp_samples:
          expected === undefined ? [] : [{ labels: '{}', value: expected }],
      },
    ],
  })),
};

const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    process.env.PROMETHEUS_CONTAINER || 'prometheus-fitwork-nestjs',
    'promtool',
    'test',
    'rules',
    '/dev/stdin',
  ],
  { input: JSON.stringify(fixtures), encoding: 'utf8' },
);
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
for (const { name } of cases) console.log(`PASS ${name}`);
