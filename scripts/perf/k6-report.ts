import type { captureAndExplain } from './explain';
import type { DatabaseSnapshot } from './k6-preflight';
import { Comparable, compareReports, K6Result } from './k6-support';
import type { SearchCase } from './k6/workload';

export type K6Report = Comparable & {
  label: string;
  startedAt: string;
  finishedAt?: string;
  preparedOnly?: boolean;
  apiBaseUrl: string;
  versions: { node: string; k6?: string; postgres?: string };
  commit?: string;
  dirty?: boolean;
  parameters: {
    profile: string;
    smoke: boolean;
    pageSize: number;
    cases: SearchCase[];
  };
  database?: DatabaseSnapshot;
  databaseAfter?: DatabaseSnapshot;
  tableDigests?: Record<string, string>;
  dataHashAfter?: string;
  preflight?: { source: string; sentinel: string; criteria: number };
  sql?: Awaited<ReturnType<typeof captureAndExplain>>;
  verified?: boolean;
  targetLoadMet?: boolean;
  error?: string;
  comparison?: ReturnType<typeof compareReports>;
  comparisonError?: string;
  artifactDirectory: string;
  accounts?: {
    count: number;
    reused: number;
    created: number;
    identitiesHash: string;
  };
};
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toFixed(2);
const safe = (text: string) => text.replace(/[|\r\n]/g, ' ');
export function renderK6Report(report: K6Report) {
  const lines = [
    `# Job search k6 — ${safe(report.label)}`,
    '',
    report.preparedOnly
      ? 'Prepared only. Preflight completed; no HTTP workload, SQL EXPLAIN or benchmark result was produced. Use the printed k6 commands.'
      : '',
    `Started: ${report.startedAt}; finished: ${report.finishedAt ?? 'in progress'}. Completed: ${report.completed}; verified: ${report.verified ?? false}; target load met: ${report.targetLoadMet ?? false}.`,
    report.error ? `Error: ${safe(report.error)}` : '',
    '',
    'Latency is k6 response.timings.duration (sending + waiting + receiving), only HTTP 200 with the repository-matching payload. It excludes blocked/connect/TLS time and is not absolutely equivalent to the old Node end-to-end timing. Warm-up is classified by request start, even when completion crosses the boundary.',
    'Successful throughput and achieved request rate use actual measurement time including drain; requested arrival rate applies to the scheduled measurement interval. Cases/processes run sequentially. Mixed/applicant criteria use global iteration modulo 12 (no production traffic/capacity claim). Applicant VUs login with distinct accounts, reuse their token, and think 1–3 seconds between searches; login timing is separate from search latency. No latency SLA is imposed.',
    '',
    `Workload SHA-256: ${report.workloadHash}. Data hash: ${report.dataHash ?? 'unavailable'}. Commit: ${report.commit ?? 'unknown'}; dirty: ${report.dirty ?? 'unknown'}.`,
    `Versions: Node ${report.versions.node}; ${report.versions.k6 ?? 'k6 unavailable'}; PostgreSQL ${report.versions.postgres ?? 'unavailable'}.`,
    `Configuration: profile=${report.parameters.profile}, smoke=${report.parameters.smoke}, pageSize=20, timeout=10s, gracefulStop=10s. API: ${safe(report.apiBaseUrl)}.`,
    'DB verification: configuration attestation + DB identity/counts + seeded sentinel + all query pages against the actual repository. Content hashes before/after detect data drift.',
    `Counts: ${JSON.stringify(report.database?.counts ?? {})}.`,
    ...(report.accounts
      ? [
          `Applicant pool: ${report.accounts.count} distinct accounts, reused ${report.accounts.reused}, created ${report.accounts.created}; identity hash ${report.accounts.identitiesHash}. Passwords/tokens are not artifacts. Login creates normal API refresh-token records; job data remains unchanged.`,
        ]
      : []),
    '',
    '| Case/load/criterion | p50 ms | p95 ms | p99 ms | success/s | issued/s | issued | OK | timeout | transport | payload | failed checks | HTTP errors | unfinished | seconds incl drain |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  ];
  const row = (name: string, r: K6Result['total']) =>
    lines.push(
      `| ${safe(name)} | ${num(r.latency.p50Ms)} | ${num(r.latency.p95Ms)} | ${num(r.latency.p99Ms)} | ${num(r.throughputRps)} | ${num(r.requestRps)} | ${r.requests} | ${r.successful} | ${r.timeouts} | ${r.transportErrors} | ${r.payloadFailures} | ${r.checkFailures} | ${JSON.stringify(r.errorsByStatus)} | ${r.interruptedRequests} | ${num(r.elapsedMs / 1000)} |`,
    );
  for (const result of report.results) {
    row(result.id, result.total);
    if (result.config.profile !== 'matrix')
      for (const criterion of result.criteria)
        row(`${result.id}/${criterion.name}`, criterion);
  }
  const applicantResults = report.results.filter(
    (r) => r.config.profile === 'applicant',
  );
  if (applicantResults.length) {
    lines.push(
      '',
      '| Applicant load | Authenticated distinct VUs / target | Login attempts | Login OK | Login p50 ms | Login p95 ms | Login p99 ms | Login check failures | Login HTTP errors | Login timeout/transport/unfinished |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    );
    for (const r of applicantResults)
      lines.push(
        `| ${r.id} | ${r.authenticatedVus}/${r.config.vus} | ${r.login.requests} | ${r.login.successful} | ${num(r.login.latency.p50Ms)} | ${num(r.login.latency.p95Ms)} | ${num(r.login.latency.p99Ms)} | ${r.login.checkFailures} | ${JSON.stringify(r.login.errorsByStatus)} | ${r.login.timeouts}/${r.login.transportErrors}/${r.login.interruptedRequests} |`,
      );
    lines.push(
      '',
      'All applicant logins complete in setup before search starts (batches of at most 10). Setup is excluded from search throughput and measurement time. Tokens must cover the entire search workload; no re-login occurs during warm-up/measurement. Applicant target means distinct authenticated VUs, not a fixed request rate. Search throughput includes final iteration drain/think time. The terminal job_search_measured trend contains only valid HTTP 200 search requests started after warm-up; built-in HTTP summary includes setup/warm-up.',
    );
  }
  lines.push(
    '',
    '| Mixed load | Target rps | Achieved issued rps incl drain | VUs allocated/max | VUs observed max | Dropped measured | Dropped warm-up | Target met |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |',
  );
  for (const r of report.results.filter((x) => x.config.profile === 'mixed'))
    lines.push(
      `| ${r.id} | ${r.config.rate} | ${num(r.total.requestRps)} | ${r.config.vus}/${r.config.vus} | ${r.observedVusMax} | ${r.droppedIterations} | ${r.warmupDroppedIterations} | ${r.targetLoadMet} |`,
    );
  lines.push(
    '',
    'Errors/check failures in warm-up also fail verification. Raw k6 metrics and summaries include warm-up; use this report for measured percentiles. Interrupted requests are issued attempts without a completed sample. Dropped iterations fail the target load; successful HTTP does not prove the rate was sustained.',
    '',
    '## Actual indexes',
    '',
    '```sql',
    ...(report.database?.indexes.map((x) => String(x.indexdef) + ';') ?? []),
    '```',
    '',
    `SQL/EXPLAIN: ${report.sql?.length ?? 0} criteria captured separately after HTTP, outside all measurement windows. Full statements/parameters/plans/buffers are in JSON.`,
    '',
    '## Baseline comparison',
    '',
  );
  if (report.comparisonError)
    lines.push(`Comparison blocked: ${safe(report.comparisonError)}`);
  if (report.comparison) {
    lines.push(
      '| Case/load | p95 delta % | p99 delta % | success/s delta % |',
      '| --- | ---: | ---: | ---: |',
    );
    for (const r of report.comparison.rows)
      lines.push(
        `| ${r.case} | ${num(r.p95DeltaPercent)} | ${num(r.p99DeltaPercent)} | ${num(r.throughputDeltaPercent)} |`,
      );
    lines.push(
      '',
      `Index diff: ${JSON.stringify(report.comparison.indexes)}`,
      report.comparison.caution,
    );
  }
  lines.push('', `Artifacts: ${report.artifactDirectory}`, '');
  return lines.join('\n');
}
