import { createHash } from 'node:crypto';
import type { Scenario } from './scenarios';
import { assertTokenLifetime } from './http';
import { canonical, SearchCase } from './k6/workload';

export function hash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export async function interruptibleStep<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal.aborted)
    throw new Error('Run interrupted; completed case artifacts retained');
  const result = await operation();
  if (signal.aborted)
    throw new Error('Run interrupted; completed case artifacts retained');
  return result;
}
export function buildCases(
  scenarios: Scenario[],
  profile: string,
  smoke: boolean,
  applicantVus: number[] = [300, 500],
): SearchCase[] {
  if (!['all', 'matrix', 'mixed', 'applicant'].includes(profile))
    throw new Error('Invalid --profile; use all|matrix|mixed|applicant');
  const cases: SearchCase[] = [];
  let startMs = 0;
  const add = (
    entry: Omit<
      SearchCase,
      'startMs' | 'gracefulStopMs' | 'timeoutMs' | 'smoke'
    >,
  ) => {
    const next = {
      ...entry,
      startMs,
      gracefulStopMs: 10000,
      timeoutMs: 10000,
      smoke,
    };
    cases.push(next);
    startMs += next.warmupMs + next.durationMs + next.gracefulStopMs;
  };
  if (profile === 'applicant') {
    if (
      !applicantVus.length ||
      applicantVus.some((x) => !Number.isSafeInteger(x) || x < 1 || x > 500) ||
      new Set(applicantVus).size !== applicantVus.length
    )
      throw new Error('--vus must contain unique integers between 1 and 500');
    for (const vus of smoke ? [2] : applicantVus)
      add({
        id: `applicant-vu${vus}`,
        profile: 'applicant',
        vus,
        warmupMs: smoke ? 0 : 10000,
        durationMs: smoke ? 1000 : 60000,
        thinkMinSeconds: smoke ? 0 : 1,
        thinkMaxSeconds: smoke ? 0 : 3,
      });
    return cases;
  }
  if (profile !== 'mixed')
    for (const scenario of scenarios)
      for (const vus of smoke ? [1] : [1, 10, 50])
        add({
          id: `matrix-${scenario.name}-vu${vus}`,
          criterion: scenario.name,
          profile: 'matrix',
          vus,
          warmupMs: smoke ? 0 : 5000,
          durationMs: smoke ? 1000 : 30000,
        });
  if (profile !== 'matrix')
    for (const rate of smoke ? [25] : [25, 50, 100])
      add({
        id: `mixed-rps${rate}`,
        profile: 'mixed',
        vus: 100,
        rate,
        warmupMs: smoke ? 1000 : 10000,
        durationMs: smoke ? 2000 : 60000,
      });
  return cases;
}
export function assertJwt(token: string, minimumMs: number) {
  let claims: { exp?: unknown };
  try {
    claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ) as { exp?: unknown };
  } catch {
    throw new Error('ACCESS_TOKEN must be a JWT with a known expiry');
  }
  if (
    !claims ||
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp) ||
    token.split('.').length !== 3
  )
    throw new Error('ACCESS_TOKEN must be a JWT with a known expiry');
  assertTokenLifetime(token, minimumMs);
}
export function redact(text: string, secrets: string[] = []) {
  let result = text;
  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    result = result.split(secret).join('[REDACTED]');
  return result
    .replace(
      /\b(?:postgres(?:ql)?|redis|https?):\/\/[^\s/@]+:[^\s/@]*@/gi,
      '[REDACTED-URL]@',
    )
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[REDACTED-JWT]',
    )
    .replace(
      /\b(password|access_token|ACCESS_TOKEN)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );
}
export type MetricPoint = {
  type: string;
  metric: string;
  data: { value: number; tags?: Record<string, string>; time: string };
};
type Bucket = {
  requests: number;
  completedRequests: number;
  successful: number;
  timeouts: number;
  transportErrors: number;
  payloadFailures: number;
  checkFailures: number;
  errorsByStatus: Record<string, number>;
  latencies: number[];
};
const bucket = (): Bucket => ({
  requests: 0,
  completedRequests: 0,
  successful: 0,
  timeouts: 0,
  transportErrors: 0,
  payloadFailures: 0,
  checkFailures: 0,
  errorsByStatus: {},
  latencies: [],
});
function consumeSample(
  target: Bucket,
  value: number,
  tags: Record<string, string>,
) {
  const status = Number(tags.status);
  target.completedRequests++;
  if (status !== 200 || tags.valid !== 'true') target.checkFailures++;
  if (tags.timeout === 'true') target.timeouts++;
  else if (status === 0) target.transportErrors++;
  else if (status !== 200)
    target.errorsByStatus[status] = (target.errorsByStatus[status] ?? 0) + 1;
  else if (tags.valid !== 'true' || !Number.isFinite(value))
    target.payloadFailures++;
  else {
    target.successful++;
    target.latencies.push(value);
  }
}
function summarize(b: Bucket, elapsedMs: number) {
  const latencies = b.latencies.sort((a, b) => a - b);
  const p = (percentile: number) =>
    latencies.length
      ? latencies[Math.max(0, Math.ceil(percentile * latencies.length) - 1)]
      : null;
  const { latencies: _latencies, ...counts } = b;
  void _latencies;
  return {
    ...counts,
    interruptedRequests: Math.max(0, b.requests - b.completedRequests),
    elapsedMs,
    throughputRps: elapsedMs ? (b.successful * 1000) / elapsedMs : 0,
    requestRps: elapsedMs ? (b.requests * 1000) / elapsedMs : 0,
    latency: {
      samples: latencies.length,
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      p99Ms: p(0.99),
    },
  };
}
export class PointCollector {
  private total = bucket();
  private perCriterion = new Map<string, Bucket>();
  private epoch = 0;
  private maxEnded = 0;
  private maxTime = 0;
  private dropped: MetricPoint[] = [];
  private observedVusMax = 0;
  private warmupFailures = 0;
  private warmupRequests = 0;
  private warmupCompleted = 0;
  private login = bucket();
  private authenticated = new Set<string>();
  private sessionEnded = 0;
  private loginEnded = 0;
  authStatus?: number;
  constructor(criteria: string[] = []) {
    criteria.forEach((name) => this.perCriterion.set(name, bucket()));
  }
  add(point: MetricPoint) {
    if (point.type !== 'Point') return;
    const { value, tags = {}, time } = point.data;
    this.maxTime = Math.max(this.maxTime, Date.parse(time) || 0);
    if (point.metric === 'vus')
      this.observedVusMax = Math.max(this.observedVusMax, value);
    if (point.metric === 'dropped_iterations') this.dropped.push(point);
    if (
      point.metric.startsWith('job_login_') ||
      point.metric === 'job_session_ended'
    ) {
      if (point.metric === 'job_session_ended') {
        if (tags.epoch) this.epoch = Number(tags.epoch);
        this.sessionEnded = Math.max(this.sessionEnded, value);
      }
      if (point.metric === 'job_login_setup_ended')
        this.loginEnded = Math.max(this.loginEnded, value);
      if (point.metric === 'job_login_started') this.login.requests += value;
      if (point.metric === 'job_login_sample') {
        this.loginEnded = Math.max(this.loginEnded, Number(tags.ended) || 0);
        consumeSample(this.login, value, tags);
        if (tags.status === '200' && tags.valid === 'true' && tags.vu)
          this.authenticated.add(tags.vu);
        if (tags.status === '401' || tags.status === '403')
          this.authStatus = Number(tags.status);
      }
      return;
    }
    if (!point.metric.startsWith('job_search_')) return;
    if (tags.epoch) this.epoch = Number(tags.epoch);
    const measured = tags.phase === 'measure';
    const criterion = tags.criterion;
    if (!criterion) return;
    const b = this.perCriterion.get(criterion) ?? bucket();
    this.perCriterion.set(criterion, b);
    if (point.metric === 'job_search_started') {
      if (measured) {
        b.requests += value;
        this.total.requests += value;
      } else this.warmupRequests += value;
    }
    if (point.metric !== 'job_search_sample') return;
    const status = Number(tags.status);
    if (status === 401 || status === 403) this.authStatus = status;
    if (!measured) {
      this.warmupCompleted++;
      if (status !== 200 || tags.valid !== 'true') this.warmupFailures++;
      return;
    }
    this.maxEnded = Math.max(this.maxEnded, Number(tags.ended) || 0);
    for (const target of [b, this.total]) consumeSample(target, value, tags);
  }
  finish(config: SearchCase, complete: boolean) {
    const boundary = config.warmupMs + config.durationMs;
    const interrupted = this.total.requests > this.total.completedRequests;
    const actualEnd = Math.max(
      this.maxEnded,
      this.epoch ? this.maxTime - this.epoch : 0,
    );
    const ended =
      config.profile === 'applicant'
        ? !complete
          ? actualEnd
          : config.smoke
            ? Math.max(this.maxEnded, this.sessionEnded)
            : Math.max(
                boundary,
                this.maxEnded,
                this.sessionEnded,
                interrupted ? actualEnd : 0,
              )
        : config.smoke && config.profile === 'matrix'
          ? interrupted
            ? actualEnd
            : this.maxEnded
          : complete
            ? Math.max(boundary, interrupted ? actualEnd : this.maxEnded)
            : actualEnd;
    const elapsedMs = Math.max(0, ended - config.warmupMs);
    const measuredDrops = this.dropped.filter(
      (p) =>
        this.epoch &&
        Date.parse(p.data.time) >= this.epoch + config.warmupMs &&
        Date.parse(p.data.time) < this.epoch + boundary,
    );
    const droppedIterations = measuredDrops.reduce(
      (n, p) => n + p.data.value,
      0,
    );
    const warmupDroppedIterations = this.dropped
      .filter(
        (p) =>
          this.epoch && Date.parse(p.data.time) < this.epoch + config.warmupMs,
      )
      .reduce((n, p) => n + p.data.value, 0);
    const total = summarize(this.total, elapsedMs);
    return {
      id: config.id,
      config,
      complete,
      startedAt: this.epoch ? new Date(this.epoch).toISOString() : undefined,
      total,
      login: summarize(this.login, this.loginEnded),
      authenticatedVus: this.authenticated.size,
      criteria: [...this.perCriterion].map(([name, b]) => ({
        name,
        ...summarize(b, elapsedMs),
      })),
      warmupRequests: this.warmupRequests,
      warmupFailures: this.warmupFailures,
      warmupInterruptedRequests: Math.max(
        0,
        this.warmupRequests - this.warmupCompleted,
      ),
      droppedIterations,
      warmupDroppedIterations,
      observedVusMax: this.observedVusMax,
      targetLoadMet:
        config.profile === 'applicant'
          ? complete && this.authenticated.size === config.vus
          : config.profile === 'mixed'
            ? complete &&
              this.epoch > 0 &&
              droppedIterations === 0 &&
              warmupDroppedIterations === 0 &&
              total.requests >=
                Math.floor(((config.rate ?? 0) * config.durationMs) / 1000)
            : undefined,
      verified:
        complete &&
        this.login.successful === this.login.requests &&
        this.warmupFailures === 0 &&
        this.warmupRequests === this.warmupCompleted &&
        total.requests > 0 &&
        total.successful === total.requests,
    };
  }
}
export function aggregatePoints(
  points: MetricPoint[],
  config: SearchCase,
  complete: boolean,
) {
  const collector = new PointCollector();
  points.forEach((p) => collector.add(p));
  return collector.finish(config, complete);
}
export type K6Result = ReturnType<PointCollector['finish']>;
export type Comparable = {
  schemaVersion: number;
  workloadHash: string;
  dataHash?: string;
  database?: {
    fingerprint: string;
    counts: Record<string, unknown>;
    indexes: Record<string, unknown>[];
  };
  completed: boolean;
  results: K6Result[];
};
export function compareReports(before: Comparable, after: Comparable) {
  if (
    before.schemaVersion !== 1 ||
    after.schemaVersion !== 1 ||
    before.workloadHash !== after.workloadHash
  )
    throw new Error('Cannot compare: workload differs');
  if (!before.completed || !after.completed)
    throw new Error('Cannot compare incomplete runs');
  if (
    !before.dataHash ||
    before.dataHash !== after.dataHash ||
    before.database?.fingerprint !== after.database?.fingerprint
  )
    throw new Error('Cannot compare: data or database identity differs');
  if (canonical(before.database?.counts) !== canonical(after.database?.counts))
    throw new Error('Cannot compare: database counts differ');
  const rows: {
    case: string;
    p95DeltaPercent: number | null;
    p99DeltaPercent: number | null;
    throughputDeltaPercent: number | null;
  }[] = [];
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null || a === 0 ? null : ((b - a) * 100) / a;
  for (const current of after.results) {
    const previous = before.results.find((x) => x.id === current.id);
    if (!previous) throw new Error('Cannot compare: case missing');
    const add = (key: string, a: K6Result['total'], b: K6Result['total']) =>
      rows.push({
        case: key,
        p95DeltaPercent: delta(a.latency.p95Ms, b.latency.p95Ms),
        p99DeltaPercent: delta(a.latency.p99Ms, b.latency.p99Ms),
        throughputDeltaPercent: delta(a.throughputRps, b.throughputRps),
      });
    add(current.id, previous.total, current.total);
    if (current.config.profile !== 'matrix')
      for (const criterion of current.criteria) {
        const old = previous.criteria.find((x) => x.name === criterion.name);
        if (!old) throw new Error('Cannot compare: criterion missing');
        add(`${current.id}/${criterion.name}`, old, criterion);
      }
  }
  if (before.results.length !== after.results.length)
    throw new Error('Cannot compare: case count differs');
  const old = (before.database?.indexes ?? []).map((x) => String(x.indexdef));
  const now = (after.database?.indexes ?? []).map((x) => String(x.indexdef));
  return {
    rows,
    indexes: {
      added: now.filter((x) => !old.includes(x)),
      removed: old.filter((x) => !now.includes(x)),
    },
    caution:
      'Inspect verified/targetLoadMet for both runs; no latency SLA or production capacity conclusion.',
  };
}
