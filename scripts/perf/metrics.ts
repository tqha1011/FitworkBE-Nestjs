import { readFile } from 'node:fs/promises';

export type CacheMetrics = { hit: number; miss: number; error: number };
export async function readCacheMetrics(): Promise<CacheMetrics> {
  if (process.env.CACHE_METRICS_FILE) {
    const snapshot = JSON.parse(
      await readFile(process.env.CACHE_METRICS_FILE, 'utf8'),
    ) as {
      collectedAt: string;
      cache: CacheMetrics;
    };
    if (Date.now() - new Date(snapshot.collectedAt).getTime() > 15_000)
      throw new Error(
        'CACHE_METRICS_FILE is stale; benchmark API metric collection must be running.',
      );
    return snapshot.cache;
  }
  if (!process.env.PROMETHEUS_URL)
    throw new Error(
      'PROMETHEUS_URL or CACHE_METRICS_FILE is required to verify reference_skills cache metrics.',
    );
  const labels = process.env.PROMETHEUS_SERVICE
    ? `,service_name=${JSON.stringify(process.env.PROMETHEUS_SERVICE)}`
    : '';
  const query = `sum by (result) (fitwork_cache_accesses_total{cache_group="reference_skills"${labels}})`;
  const url = new URL('/api/v1/query', process.env.PROMETHEUS_URL);
  url.searchParams.set('query', query);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Prometheus HTTP ${response.status}`);
  const result = (await response.json()) as {
    status: string;
    data: {
      result: {
        metric: { result: keyof CacheMetrics };
        value: [number, string];
      }[];
    };
  };
  if (result.status !== 'success')
    throw new Error('Prometheus cache metric query failed');
  const counts: CacheMetrics = { hit: 0, miss: 0, error: 0 };
  for (const point of result.data.result)
    counts[point.metric.result] = Number(point.value[1]);
  return counts;
}
export function metricDelta(
  after: CacheMetrics,
  before: CacheMetrics,
): CacheMetrics {
  return {
    hit: after.hit - before.hit,
    miss: after.miss - before.miss,
    error: after.error - before.error,
  };
}

export async function waitForCacheMetrics(
  before: CacheMetrics,
  requests: number,
) {
  const deadline =
    Date.now() + Number(process.env.CACHE_METRICS_WAIT_MS ?? 45_000);
  let after = await readCacheMetrics();
  while (Date.now() < deadline) {
    const delta = metricDelta(after, before);
    if (delta.hit + delta.miss + delta.error >= requests)
      return { before, after, delta };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    after = await readCacheMetrics();
  }
  throw new Error(
    'Cache metric export did not catch up; check exporter interval, Prometheus labels and API instance.',
  );
}
