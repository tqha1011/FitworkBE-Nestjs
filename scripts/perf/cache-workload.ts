import { isDeepStrictEqual } from 'node:util';
import { ReferenceDataCacheKey } from '../../src/modules/job/application/constants/reference-data-cache.constants';
import {
  CaseResult,
  request,
  ResponseSample,
  runCase,
  TokenError,
} from './http';
import { CacheMetrics, waitForCacheMetrics } from './metrics';

type MetricComparison = Awaited<ReturnType<typeof waitForCacheMetrics>>;
type ExpectedAccesses = { minimum: number; maximum: number };
type MissResult = {
  samples: number;
  successful: number;
  timeouts: number;
  transportErrors: number;
  errorsByStatus: Record<string, number>;
  latency: {
    samples: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  metrics?: MetricComparison;
  metricExpected: ExpectedAccesses;
  note: string;
};
export type SkillsBenchmarkResult = {
  miss: MissResult;
  hits: (CaseResult & {
    metrics?: MetricComparison;
    metricExpected: ExpectedAccesses;
  })[];
  payloadEqual: boolean;
  logicalKey: string;
  metric: string;
  error?: string;
};
export type SkillsDependencies = {
  request: () => ReturnType<typeof request>;
  deleteKey: () => Promise<void>;
  hasKey: () => Promise<boolean>;
  readMetrics: () => Promise<CacheMetrics>;
  waitMetrics: (
    before: CacheMetrics,
    minimumAccesses: number,
  ) => Promise<MetricComparison>;
};
function summarizeMiss(samples: ResponseSample[]): MissResult {
  const successful = samples.filter((x) => x.status >= 200 && x.status < 300);
  const latency = successful.map((x) => x.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    latency.length
      ? latency[Math.max(0, Math.ceil(p * latency.length) - 1)]
      : null;
  const errorsByStatus: Record<string, number> = {};
  for (const sample of samples)
    if (sample.status >= 300)
      errorsByStatus[sample.status] = (errorsByStatus[sample.status] ?? 0) + 1;
  return {
    samples: samples.length,
    successful: successful.length,
    timeouts: samples.filter((x) => x.timeout).length,
    transportErrors: samples.filter((x) => x.status === 0 && !x.timeout).length,
    errorsByStatus,
    latency: {
      samples: latency.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
    },
    metricExpected: { minimum: successful.length, maximum: samples.length },
    note: 'Serial samples. Key deletion is outside HTTP latency; PostgreSQL buffers remain intact. Failed HTTP requests may or may not have accessed Redis, so metric expectations span successful through attempted requests.',
  };
}
function verifyMetrics(
  kind: 'hit' | 'miss',
  metrics: MetricComparison,
  expected: ExpectedAccesses,
) {
  const other = kind === 'hit' ? 'miss' : 'hit';
  if (
    metrics.delta[kind] < expected.minimum ||
    metrics.delta[kind] > expected.maximum ||
    metrics.delta[other] !== 0 ||
    metrics.delta.error !== 0
  )
    throw new Error(
      `Skills ${kind} metric disagrees with requests; Redis/TTL errors or other traffic detected`,
    );
}
export async function runSkillsBenchmark(
  options: {
    missSamples: number;
    concurrencies: number[];
    warmupMs: number;
    durationMs: number;
  },
  dependencies: SkillsDependencies,
): Promise<SkillsBenchmarkResult> {
  const samples: ResponseSample[] = [];
  const result: SkillsBenchmarkResult = {
    miss: summarizeMiss(samples),
    hits: [],
    payloadEqual: false,
    logicalKey: ReferenceDataCacheKey.Skills,
    metric: 'fitwork_cache_accesses_total{cache_group="reference_skills"}',
  };
  let baseline: unknown;
  let comparedHits = 0;
  let payloadMismatch = false;
  const observe = (sample: ResponseSample) => {
    if (sample.status >= 200 && sample.status < 300) {
      if (!Array.isArray(sample.body)) {
        payloadMismatch = true;
        throw new Error('Unexpected /api/skills payload');
      }
      if (baseline === undefined) baseline = sample.body;
      else if (!isDeepStrictEqual(baseline, sample.body)) {
        payloadMismatch = true;
        throw new Error('Skills miss/hit payload differs');
      }
    }
  };
  const checkAuth = (sample: ResponseSample) => {
    if (sample.status === 401 || sample.status === 403)
      throw new TokenError(
        `HTTP ${sample.status}: access token expired, invalid or unauthorized.`,
      );
  };
  try {
    const before = await dependencies.readMetrics();
    for (let index = 0; index < options.missSamples; index++) {
      await dependencies.deleteKey();
      if (await dependencies.hasKey())
        throw new Error('Skills logical key still present after delete');
      const sample = await dependencies.request();
      samples.push(sample);
      result.miss = summarizeMiss(samples);
      checkAuth(sample);
      observe(sample);
      if (
        sample.status >= 200 &&
        sample.status < 300 &&
        !(await dependencies.hasKey())
      )
        throw new Error(
          'API did not populate this Redis skills key; confirm REDIS_URL matches the API',
        );
    }
    result.miss.metrics = await dependencies.waitMetrics(
      before,
      result.miss.successful,
    );
    verifyMetrics('miss', result.miss.metrics, result.miss.metricExpected);
    if (!result.miss.successful)
      throw new Error(
        'No successful skills miss samples; cannot verify miss/hit payload',
      );
    for (const concurrency of options.concurrencies) {
      if (!(await dependencies.hasKey()))
        throw new Error('Skills key absent before hit benchmark');
      const beforeHit = await dependencies.readMetrics();
      let successful = 0;
      let attempted = 0;
      const checked = async () => {
        const sample = await dependencies.request();
        attempted++;
        if (sample.status >= 200 && sample.status < 300) successful++;
        observe(sample);
        if (sample.status >= 200 && sample.status < 300) comparedHits++;
        return sample;
      };
      const warm = await checked();
      checkAuth(warm);
      if (warm.status < 200 || warm.status >= 300)
        throw new Error(`Skills warm-up failed: HTTP ${warm.status}`);
      const measured = await runCase(checked, {
        concurrency,
        warmupMs: options.warmupMs,
        durationMs: options.durationMs,
      });
      const hit: SkillsBenchmarkResult['hits'][number] = {
        ...measured,
        metricExpected: { minimum: successful, maximum: attempted },
      };
      result.hits.push(hit); // Preserve measurements before telemetry/auth verification.
      if (hit.authError) throw new TokenError(hit.authError);
      if (hit.error) throw new Error(hit.error);
      hit.metrics = await dependencies.waitMetrics(beforeHit, successful);
      verifyMetrics('hit', hit.metrics, hit.metricExpected);
    }
  } catch (error: unknown) {
    result.error =
      error instanceof Error ? error.message : 'Skills benchmark failed';
  }
  result.payloadEqual = comparedHits > 0 && !payloadMismatch;
  return result;
}
