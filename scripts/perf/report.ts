import { CaseResult } from './http';
import { captureAndExplain } from './explain';
import { benchmarkSkills } from './cache';
import { inspectDatabase } from './database';

export type BenchmarkReport = {
  startedAt: string;
  completedAt?: string;
  apiBaseUrl: string;
  parameters: {
    pageSize: number;
    concurrencies: number[];
    warmupMs: number;
    durationMs: number;
    timeoutMs: number;
  };
  database?: Awaited<ReturnType<typeof inspectDatabase>>;
  databaseVerified?: {
    source: string;
    fingerprint: string;
    sentinel: string;
    scenariosMatch: boolean;
  };
  search: (CaseResult & { name: string })[];
  sql?: Awaited<ReturnType<typeof captureAndExplain>>;
  skills?: Awaited<ReturnType<typeof benchmarkSkills>>;
  error?: string;
};
const number = (value: number | null | undefined) =>
  value == null ? '—' : value.toFixed(2);
export function renderReport(report: BenchmarkReport) {
  const lines = [
    '# Job search / skills cache baseline',
    '',
    `Started: ${report.startedAt}. Completed: ${report.completedAt ?? 'in progress'}. API: ${report.apiBaseUrl}.`,
    '',
    'Fixed-concurrency, closed-loop measurement; these results do not establish maximum capacity. Warm-up requests and failed requests are excluded from successful latency percentiles. Throughput is successful requests / elapsed time including the final in-flight requests.',
    '',
    `Page size ${report.parameters.pageSize}; warm-up ${report.parameters.warmupMs} ms; target measurement ${report.parameters.durationMs} ms; timeout ${report.parameters.timeoutMs} ms.`,
    '',
    '| Scenario | Concurrency | Success | p50 ms | p95 ms | p99 ms | Success req/s | Timeouts | Transport | HTTP errors |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...report.search.map(
      (x) =>
        `| ${x.name} | ${x.concurrency} | ${x.successful} | ${number(x.latency.p50Ms)} | ${number(x.latency.p95Ms)} | ${number(x.latency.p99Ms)} | ${number(x.throughputRps)} | ${x.timeouts} | ${x.transportErrors} | ${JSON.stringify(x.errorsByStatus)} |`,
    ),
  ];
  if (report.error) lines.push('', `Run incomplete: ${report.error}`);
  if (report.database) {
    lines.push(
      '',
      '## Database',
      '',
      `Identity: ${JSON.stringify(report.database.identity)}.`,
      '',
      `Totals: ${JSON.stringify(report.database.counts)}.`,
      '',
      `Verification: ${JSON.stringify(report.databaseVerified)}.`,
      '',
      'Actual pg_indexes:',
      '',
      '```sql',
      ...report.database.indexes.map((x) => String(x.indexdef) + ';'),
      '```',
    );
  }
  if (report.sql) {
    lines.push(
      '',
      '## Repository SQL and EXPLAIN',
      '',
      'EXPLAIN ANALYZE ran separately from HTTP timing, with the default planner. PostgreSQL buffers were not cleared. JSON includes SQL, parameters, full plans and per-node scan/sort/row/buffer details. Buffer counters on parent nodes include children; do not sum them.',
      '',
      '| Scenario | SQL statements | EXPLAIN execution total ms | Scans / sorts |',
      '|---|---:|---:|---|',
    );
    for (const x of report.sql) {
      const nodes = x.queries
        .flatMap((q) => q.nodes)
        .filter((n) => /Scan|Sort/.test(n['Node Type']));
      lines.push(
        `| ${x.name} | ${x.queries.length} | ${number(x.queries.reduce((sum, q) => sum + q.plan['Execution Time'], 0))} | ${[...new Set(nodes.map((n) => `${n['Node Type']} ${n['Relation Name'] ?? ''} ${n['Index Name'] ?? ''} ${n['Sort Method'] ?? ''}`))].join('; ')} |`,
      );
    }
  }
  if (report.skills) {
    const miss = report.skills.miss;
    if (report.skills.error)
      lines.push('', `Skills measurement incomplete: ${report.skills.error}`);
    lines.push(
      '',
      '## Skills Redis cache',
      '',
      `Miss/hit payload equality: ${report.skills.payloadEqual}. Only logical key ${report.skills.logicalKey} was deleted; Redis was not flushed. A Redis miss does not mean cold database buffers. Search has no results cache; skills cache changes do not explain search latency.`,
      '',
      `Miss: ${miss.successful}/${miss.samples} serial samples; p50 ${number(miss.latency.p50Ms)} ms, p95 ${number(miss.latency.p95Ms)} ms, p99 ${number(miss.latency.p99Ms)} ms. Timeouts ${miss.timeouts}; transport errors ${miss.transportErrors}; HTTP errors ${JSON.stringify(miss.errorsByStatus)}. Metric delta ${JSON.stringify(miss.metrics?.delta ?? null)}.`,
      '',
      '| Hit concurrency | Success | p50 ms | p95 ms | p99 ms | Success req/s | Timeouts | Transport | HTTP errors | Metric delta (includes warm-up) |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---|---|',
      ...report.skills.hits.map(
        (x) =>
          `| ${x.concurrency} | ${x.successful} | ${number(x.latency.p50Ms)} | ${number(x.latency.p95Ms)} | ${number(x.latency.p99Ms)} | ${number(x.throughputRps)} | ${x.timeouts} | ${x.transportErrors} | ${JSON.stringify(x.errorsByStatus)} | ${JSON.stringify(x.metrics?.delta ?? null)} |`,
      ),
    );
  }
  lines.push('', '## Evidence and next steps', '');
  const ranked = report.search
    .filter((x) => x.latency.p95Ms !== null)
    .sort((a, b) => b.latency.p95Ms! - a.latency.p95Ms!);
  if (ranked.length) {
    const worst = ranked[0];
    lines.push(
      `Highest observed search p95: ${worst.name}, concurrency ${worst.concurrency}, ${number(worst.latency.p95Ms)} ms. This ranking is an observation, not a diagnosis of causality.`,
    );
  }
  if (report.sql) {
    const slow = report.sql
      .flatMap((x) => x.queries.map((q) => ({ scenario: x.name, q })))
      .sort(
        (a, b) => b.q.plan['Execution Time'] - a.q.plan['Execution Time'],
      )[0];
    if (slow)
      lines.push(
        `Slowest separately explained statement: ${slow.scenario}, ${number(slow.q.plan['Execution Time'])} ms. Inspect its actual/estimated rows, root buffers and relation query timings in JSON.`,
      );
    const nodes = report.sql.flatMap((x) => x.queries.flatMap((q) => q.nodes));
    if (
      nodes.some(
        (n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'job',
      )
    )
      lines.push(
        'Observed sequential job scans: next compare selective title/category/budget queries and counts; evaluate trigram or composite indexes in a separate experiment using these captured plans.',
      );
    if (nodes.some((n) => /Sort/.test(n['Node Type'])))
      lines.push(
        'Observed sorting: compare an index supporting OPEN + created_at/due_at ordering against write cost and filter selectivity in a separate experiment.',
      );
    if (
      nodes.some(
        (n) =>
          n['Sort Space Type'] === 'Disk' ||
          (n['Temp Written Blocks'] ?? 0) > 0,
      )
    )
      lines.push(
        'Observed temporary writes or disk sorts: inspect memory settings and row width before tuning.',
      );
    lines.push(
      'Compare deep OFFSET page timing with first-page timing; evaluate keyset pagination separately if deep-page cost dominates. Compare SQL time with HTTP p95 to investigate pool contention or application work. No index or search cache was changed by this benchmark.',
    );
  } else
    lines.push(
      'No database plans captured yet; bottleneck diagnosis awaits a completed database/API baseline.',
    );
  return lines.join('\n') + '\n';
}
