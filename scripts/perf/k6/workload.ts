// Pure local helpers shared by Node and k6 (k6 >= 0.57 supports TypeScript).
export type SearchCase = {
  id: string;
  profile: 'matrix' | 'mixed' | 'applicant';
  criterion?: string;
  vus: number;
  rate?: number;
  warmupMs: number;
  durationMs: number;
  gracefulStopMs: number;
  timeoutMs: number;
  startMs: number;
  smoke: boolean;
  thinkMinSeconds?: number;
  thinkMaxSeconds?: number;
};
export type K6Config = SearchCase & {
  apiBaseUrl: string;
  queries: { name: string; query: string; expected: unknown }[];
};

export function mixedIndex(iteration: number, count: number) {
  return iteration % count;
}
export function thinkTimeSeconds(iteration: number, min: number, max: number) {
  return min + (iteration % (max - min + 1));
}
export function sessionFromLogin(
  payload: unknown,
  publicId: string,
  nowMs: number,
  decode: (value: string) => string,
): { token: string; expiresAtMs: number } | null {
  if (
    !record(payload) ||
    typeof payload.accessToken !== 'string' ||
    typeof payload.expiresIn !== 'number' ||
    !Number.isFinite(payload.expiresIn) ||
    payload.expiresIn <= 0
  )
    return null;
  try {
    const parts = payload.accessToken.split('.');
    if (parts.length !== 3) return null;
    const claims: unknown = JSON.parse(decode(parts[1]));
    if (
      !record(claims) ||
      claims.sub !== publicId ||
      claims.role !== 'ROLE_APPLICANT' ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= nowMs + 10000
    )
      return null;
    return { token: payload.accessToken, expiresAtMs: claims.exp * 1000 };
  } catch {
    return null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function reference(value: unknown) {
  return (
    record(value) &&
    Number.isSafeInteger(value.id) &&
    typeof value.name === 'string'
  );
}
// Compare every returned field to the repository snapshot, independent of object
// property order and relation ordering. Dates in the config are JSON strings.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function normalizePage(value: Record<string, unknown>) {
  return {
    ...value,
    items: (value.items as Record<string, unknown>[]).map((item) => ({
      ...item,
      skills: (item.skills as { id: number }[])
        .slice()
        .sort((a, b) => a.id - b.id),
    })),
  };
}
export function validPage(value: unknown, expected: unknown): boolean {
  if (
    !record(value) ||
    !record(expected) ||
    !Array.isArray(value.items) ||
    !Array.isArray(expected.items)
  )
    return false;
  if (
    !Number.isSafeInteger(value.totalPages) ||
    Number(value.totalPages) < 0 ||
    !Number.isSafeInteger(value.pageNumber) ||
    !Number.isSafeInteger(value.pageSize) ||
    typeof value.hasPrevious !== 'boolean' ||
    typeof value.hasNext !== 'boolean'
  )
    return false;
  if (
    !value.items.every(
      (item) =>
        record(item) &&
        typeof item.publicId === 'string' &&
        typeof item.title === 'string' &&
        typeof item.description === 'string' &&
        typeof item.location === 'string' &&
        typeof item.budget === 'number' &&
        Number.isFinite(item.budget) &&
        ['VND', 'USD'].includes(String(item.currency)) &&
        typeof item.dueAt === 'string' &&
        Number.isFinite(Date.parse(item.dueAt)) &&
        Number.isSafeInteger(item.totalApplicants) &&
        Array.isArray(item.skills) &&
        item.skills.every(reference) &&
        reference(item.category) &&
        reference(item.arrangement),
    )
  )
    return false;
  try {
    return (
      canonical(normalizePage(value)) === canonical(normalizePage(expected))
    );
  } catch {
    return false;
  }
}

export function buildOptions(config: SearchCase) {
  const common = { exec: 'search', gracefulStop: `${config.gracefulStopMs}ms` };
  const scenario =
    config.profile === 'applicant'
      ? config.smoke
        ? {
            ...common,
            executor: 'per-vu-iterations',
            vus: config.vus,
            iterations: 12,
            maxDuration: '60000ms',
          }
        : {
            ...common,
            executor: 'constant-vus',
            vus: config.vus,
            duration: `${config.warmupMs + config.durationMs}ms`,
          }
      : config.profile === 'matrix'
        ? config.smoke
          ? {
              ...common,
              executor: 'shared-iterations',
              vus: 1,
              iterations: 1,
              maxDuration: `${config.timeoutMs + 1000}ms`,
            }
          : {
              ...common,
              executor: 'constant-vus',
              vus: config.vus,
              duration: `${config.warmupMs + config.durationMs}ms`,
            }
        : {
            ...common,
            executor: 'constant-arrival-rate',
            rate: config.rate,
            timeUnit: '1s',
            duration: `${config.warmupMs + config.durationMs}ms`,
            preAllocatedVUs: config.vus,
            maxVUs: config.vus,
          };
  return {
    scenarios: { search: scenario },
    ...(config.profile === 'applicant'
      ? { setupTimeout: '600000ms', batch: 10, batchPerHost: 10 }
      : {}),
    systemTags: ['status', 'method', 'name', 'scenario', 'error_code'],
    summaryTrendStats: ['med', 'p(95)', 'p(99)'],
    // No latency SLA. The runner marks correctness/load from measured points.
    thresholds: {},
  };
}
