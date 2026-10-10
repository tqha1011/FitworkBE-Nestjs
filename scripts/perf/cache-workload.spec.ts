import { runSkillsBenchmark } from './cache-workload';
import { metricDelta } from './metrics';

const options = {
  missSamples: 2,
  concurrencies: [1],
  warmupMs: 0,
  durationMs: 5,
};
function fixture(
  failFirstMiss: false | 'http' | 'timeout' = false,
  expireSecondHit = false,
) {
  let cached = false;
  let requests = 0;
  let reads = 0;
  let requestsSinceRead = 0;
  const metrics = { hit: 0, miss: 0, error: 0 };
  return {
    deleteKey: () => {
      cached = false;
      return Promise.resolve();
    },
    hasKey: () => Promise.resolve(cached),
    readMetrics: () => {
      reads++;
      requestsSinceRead = 0;
      return Promise.resolve({ ...metrics });
    },
    waitMetrics: (before: typeof metrics) =>
      Promise.resolve({
        before,
        after: { ...metrics },
        delta: metricDelta(metrics, before),
      }),
    request: () => {
      requests++;
      requestsSinceRead++;
      if (expireSecondHit && reads === 3 && requestsSinceRead > 1)
        return Promise.resolve({
          status: 401,
          timeout: false,
          latencyMs: 3,
          body: {},
        });
      const hit = cached;
      metrics[hit ? 'hit' : 'miss']++;
      cached = true;
      // A real cache access can precede an HTTP 500 or a client timeout.
      return Promise.resolve({
        status:
          failFirstMiss && requests === 1
            ? failFirstMiss === 'timeout'
              ? 0
              : 500
            : 200,
        timeout: failFirstMiss === 'timeout' && requests === 1,
        latencyMs: requests === 1 ? 999 : 3,
        body: [{ id: 1, name: 'TypeScript' }],
      });
    },
  };
}

it.each(['http', 'timeout'] as const)(
  'retains %s failures after cache accesses without counting them in successful latency',
  async (failure) => {
    const result = await runSkillsBenchmark(options, fixture(failure));
    expect(result.error).toBeUndefined();
    expect(result.miss.samples).toBe(2);
    expect(result.miss.successful).toBe(1);
    expect(result.miss.errorsByStatus).toEqual(
      failure === 'http' ? { 500: 1 } : {},
    );
    expect(result.miss.timeouts).toBe(failure === 'timeout' ? 1 : 0);
    expect(result.miss.latency.p95Ms).toBe(3);
    expect(result.miss.metrics?.delta).toEqual({ miss: 2, hit: 0, error: 0 });
    expect(result.miss.metricExpected).toEqual({ minimum: 1, maximum: 2 });
    expect(result.hits).toHaveLength(1);
  },
);

it('preserves completed cache cases and partial HTTP status counts on token expiration', async () => {
  const result = await runSkillsBenchmark(
    { ...options, missSamples: 1, concurrencies: [1, 2] },
    fixture(false, true),
  );
  expect(result.error).toMatch(/401.*token/i);
  expect(result.miss.samples).toBe(1);
  expect(result.hits).toHaveLength(2);
  expect(result.hits[0].successful).toBeGreaterThan(0);
  expect(result.hits[1].errorsByStatus['401']).toBeGreaterThan(0);
});

it('retains miss evidence and rejects unexpected hit traffic in a miss phase', async () => {
  const dependencies = fixture();
  dependencies.waitMetrics = (before) =>
    Promise.resolve({
      before,
      after: { hit: 1, miss: 2, error: 0 },
      delta: { hit: 1, miss: 2, error: 0 },
    });
  const result = await runSkillsBenchmark(options, dependencies);
  expect(result.error).toMatch(/miss metric/i);
  expect(result.miss.successful).toBe(2);
  expect(result.miss.metrics?.delta.hit).toBe(1);
});

it('stops a hit workload on payload mismatch while preserving completed measurements', async () => {
  const dependencies = fixture();
  const original = dependencies.request;
  let requests = 0;
  dependencies.request = async () => {
    const sample = await original();
    requests++;
    return requests > 3
      ? { ...sample, body: [{ id: 2, name: 'Different' }] }
      : sample;
  };
  const result = await runSkillsBenchmark(options, dependencies);
  expect(result.error).toMatch(/payload differs/i);
  expect(result.miss.samples).toBe(2);
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0].error).toMatch(/payload differs/i);
  expect(result.payloadEqual).toBe(false);
});
