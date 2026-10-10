import { scenarioQuery, scenarios } from './scenarios';
import {
  buildCases,
  assertJwt,
  redact,
  compareReports,
  aggregatePoints,
  interruptibleStep,
} from './k6-support';
import { mixedIndex, validPage, buildOptions } from './k6/workload';

const cases = scenarios(
  Array.from({ length: 10 }, (_, i) => i + 1),
  Array.from({ length: 30 }, (_, i) => i + 1),
);
const job = {
  publicId: 'id',
  title: 'Backend',
  description: 'text',
  location: 'Remote',
  budget: 10,
  currency: 'VND',
  dueAt: '2026-10-01T00:00:00.000Z',
  totalApplicants: 0,
  skills: [{ id: 5, name: 'TS' }],
  category: { id: 1, name: 'IT' },
  arrangement: { id: 1, name: 'Remote' },
};
const page = {
  items: [job],
  totalPages: 3,
  pageNumber: 1,
  pageSize: 20,
  hasPrevious: false,
  hasNext: true,
};
it('preserves an interrupted state when SIGINT arrives during post-HTTP SQL or baseline processing', async () => {
  const controller = new AbortController();
  await expect(
    interruptibleStep(controller.signal, () => {
      controller.abort();
      return Promise.resolve('SQL complete');
    }),
  ).rejects.toThrow(/interrupted/);
  let started = false;
  await expect(
    interruptibleStep(controller.signal, () => {
      started = true;
      return Promise.resolve('baseline');
    }),
  ).rejects.toThrow(/interrupted/);
  expect(started).toBe(false);
});

it('serializes arrays with OR semantics and preserves encoded title/budget/page parameters', () => {
  expect(
    scenarioQuery(
      {
        name: 'x',
        pageNumber: 1000,
        filter: { title: 'C++ & API', skillIds: [5, 28], budgetMin: 0 },
      },
      20,
    ),
  ).toBe(
    'pageNumber=1000&pageSize=20&title=C%2B%2B+%26+API&skillIds=5%2C28&budgetMin=0',
  );
});
it('schedules 36 matrix and 3 mixed cases sequentially including drain, with one-request smoke matrix', () => {
  const all = buildCases(cases, 'all', false);
  expect(all).toHaveLength(39);
  expect(all[0]).toMatchObject({
    profile: 'matrix',
    vus: 1,
    warmupMs: 5000,
    durationMs: 30000,
  });
  expect(all[36]).toMatchObject({
    profile: 'mixed',
    rate: 25,
    vus: 100,
    warmupMs: 10000,
    durationMs: 60000,
  });
  for (let i = 1; i < all.length; i++)
    expect(all[i].startMs).toBeGreaterThanOrEqual(
      all[i - 1].startMs +
        all[i - 1].warmupMs +
        all[i - 1].durationMs +
        all[i - 1].gracefulStopMs,
    );
  const smoke = buildCases(cases, 'all', true);
  expect(smoke).toHaveLength(13);
  expect(buildOptions(smoke[0]).scenarios.search).toMatchObject({
    executor: 'shared-iterations',
    vus: 1,
    iterations: 1,
  });
  expect(buildOptions(all[0]).scenarios.search).toMatchObject({
    executor: 'constant-vus',
    vus: 1,
    duration: '35000ms',
    gracefulStop: '10000ms',
  });
  expect(buildOptions(all[36]).scenarios.search).toMatchObject({
    executor: 'constant-arrival-rate',
    rate: 25,
    preAllocatedVUs: 100,
    maxVUs: 100,
    duration: '70000ms',
  });
});
it('assigns consecutive global mixed iterations deterministically with equal shares', () => {
  expect(Array.from({ length: 15 }, (_, i) => mixedIndex(i, 12))).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2,
  ]);
  expect(
    Array.from({ length: 120 }, (_, i) => mixedIndex(i, 12)).filter(
      (x) => x === 7,
    ),
  ).toHaveLength(10);
});
it('checks payload structure, pagination and actual repository item values', () => {
  expect(validPage(page, page)).toBe(true);
  expect(validPage({ ...page, items: [{ ...job, budget: '10' }] }, page)).toBe(
    false,
  );
  expect(
    validPage(
      { ...page, items: [{ ...job, skills: [{ id: 28, name: 'TS' }] }] },
      page,
    ),
  ).toBe(false);
  expect(validPage({ ...page, totalPages: 4 }, page)).toBe(false);
  expect(validPage(null, page)).toBe(false);
  expect(validPage({ ...page, items: [{ publicId: 'id' }] }, page)).toBe(false);
});

function point(
  metric: string,
  value: number,
  tags: Record<string, string> = {},
  time = '2026-10-10T00:00:01.000Z',
) {
  return { type: 'Point', metric, data: { value, tags, time } };
}
it('excludes warm-up by request start and errors from latency; uses elapsed measurement including drain', () => {
  const config = {
    ...buildCases(cases, 'mixed', true)[0],
    warmupMs: 1000,
    durationMs: 2000,
  };
  const points = [
    point('job_search_started', 1, {
      phase: 'warmup',
      criterion: 'first-page',
      epoch: '1791590400000',
    }),
    point('job_search_sample', 999, {
      phase: 'warmup',
      criterion: 'first-page',
      status: '200',
      valid: 'true',
      ended: '1500',
    }),
    ...['200', '500', '0', '200'].flatMap((status, i) => [
      point('job_search_started', 1, {
        phase: 'measure',
        criterion: 'first-page',
        epoch: '1791590400000',
      }),
      point('job_search_sample', i === 0 ? 12 : 500, {
        phase: 'measure',
        criterion: 'first-page',
        status,
        valid: String(i === 0),
        timeout: String(i === 2),
        ended: '3500',
      }),
    ]),
    point('dropped_iterations', 3, {}, '2026-10-10T00:00:00.500Z'),
    point('dropped_iterations', 2, {}, '2026-10-10T00:00:02.000Z'),
    point('vus', 4),
  ];
  const result = aggregatePoints(points, config, true);
  expect(result.total).toMatchObject({
    requests: 4,
    successful: 1,
    timeouts: 1,
    payloadFailures: 1,
    errorsByStatus: { '500': 1 },
    elapsedMs: 2500,
    throughputRps: 0.4,
    requestRps: 1.6,
    latency: { samples: 1, p95Ms: 12, p99Ms: 12 },
  });
  expect(result.droppedIterations).toBe(2);
  expect(result.warmupDroppedIterations).toBe(3);
  expect(result.observedVusMax).toBe(4);
  expect(result.verified).toBe(false);
  expect(result.targetLoadMet).toBe(false);
});
it('tracks interrupted in-flight requests and transport/401 as failed attempts', () => {
  const config = buildCases(cases, 'matrix', true)[0];
  const result = aggregatePoints(
    [
      point('job_search_started', 2, {
        phase: 'measure',
        criterion: 'first-page',
        epoch: '1791590400000',
      }),
      point('job_search_sample', 50, {
        phase: 'measure',
        criterion: 'first-page',
        status: '401',
        valid: 'false',
        ended: '50',
      }),
    ],
    config,
    false,
  );
  expect(result.total).toMatchObject({
    successful: 0,
    interruptedRequests: 1,
    errorsByStatus: { '401': 1 },
    latency: { p95Ms: null },
  });
  expect(result.verified).toBe(false);
});
it('includes forced drain for unfinished attempts and records every failing check', () => {
  const config = {
    ...buildCases(cases, 'matrix', false)[0],
    warmupMs: 0,
    durationMs: 1000,
  };
  const result = aggregatePoints(
    [
      point('job_search_started', 2, {
        phase: 'measure',
        criterion: 'first-page',
        epoch: '1791590400000',
      }),
      point('job_search_sample', 100, {
        phase: 'measure',
        criterion: 'first-page',
        status: '500',
        valid: 'false',
        ended: '100',
      }),
      point('vus', 1, {}, '2026-10-10T00:00:11.000Z'),
    ],
    config,
    true,
  );
  expect(result.total.elapsedMs).toBe(11000);
  expect(result.total.checkFailures).toBe(1);
  expect(result.total.interruptedRequests).toBe(1);
});
it('requires a JWT with sufficient known expiry and redacts secrets even in error text/URLs', () => {
  const jwt = (exp: number) =>
    `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`;
  expect(() => assertJwt(jwt(1), 1000)).toThrow(/expired/);
  expect(() => assertJwt(jwt(Date.now() / 1000 + 10), 60000)).toThrow(
    /expires/,
  );
  expect(() => assertJwt('opaque', 1000)).toThrow(/JWT/);
  expect(() => assertJwt(jwt(Date.now() / 1000 + 3600), 60000)).not.toThrow();
  const token = jwt(9999999999);
  const result = redact(
    `Bearer ${token} postgresql://user:p%40ss@localhost/db password=p%40ss`,
    [token, 'p%40ss'],
  );
  expect(result).not.toContain(token);
  expect(result).not.toContain('p%40ss');
});
it('blocks mismatched workload/data/counts, permits index changes and calculates matching-case deltas', () => {
  const config = buildCases(cases, 'matrix', true)[0];
  const result = aggregatePoints(
    [
      point('job_search_started', 1, {
        phase: 'measure',
        criterion: 'first-page',
        epoch: '1791590400000',
      }),
      point('job_search_sample', 20, {
        phase: 'measure',
        criterion: 'first-page',
        status: '200',
        valid: 'true',
        ended: '100',
      }),
    ],
    config,
    true,
  );
  const baseline = {
    schemaVersion: 1,
    workloadHash: 'abc',
    dataHash: 'same',
    database: {
      fingerprint: 'db',
      counts: { jobs: 50000 },
      indexes: [{ indexdef: 'old' }],
    },
    completed: true,
    results: [result],
  };
  const current = {
    ...baseline,
    database: { ...baseline.database, indexes: [{ indexdef: 'new' }] },
    results: [
      {
        ...result,
        total: {
          ...result.total,
          latency: { ...result.total.latency, p95Ms: 10 },
          throughputRps: 20,
        },
      },
    ],
  };
  const comparison = compareReports(baseline, current);
  expect(comparison.indexes).toEqual({ added: ['new'], removed: ['old'] });
  expect(comparison.rows[0]).toMatchObject({
    p95DeltaPercent: -50,
    throughputDeltaPercent: 100,
  });
  expect(() =>
    compareReports(baseline, { ...current, workloadHash: 'xyz' }),
  ).toThrow(/workload/);
  expect(() =>
    compareReports(baseline, { ...current, dataHash: 'different' }),
  ).toThrow(/data/);
  expect(() =>
    compareReports(baseline, {
      ...current,
      database: { ...current.database, counts: { jobs: 50001 } },
    }),
  ).toThrow(/count/);
});
