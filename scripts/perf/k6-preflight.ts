import type { Pool } from 'pg';
import type { Scenario } from './scenarios';
import { scenarios, scenarioQuery } from './scenarios';
import { perfId } from './dataset';
import { hash } from './k6-support';
import { canonical, validPage } from './k6/workload';
import { request, TokenError } from './http';
import type { inspectDatabase } from './database';

export type DatabaseSnapshot = Awaited<ReturnType<typeof inspectDatabase>>;
export type K6Manifest = {
  namespace: string;
  requestedJobs: number;
  database: DatabaseSnapshot;
  scenarios: Scenario[];
  sentinel: { publicId: string; title: string };
};
export function parseManifest(text: string): K6Manifest {
  const manifest = JSON.parse(text) as K6Manifest;
  const names = scenarios(
    Array.from({ length: 10 }, (_, i) => i),
    Array.from({ length: 30 }, (_, i) => i),
  ).map((x) => x.name);
  if (
    manifest.namespace !== 'perf:v1' ||
    manifest.requestedJobs !== 50000 ||
    !manifest.database?.fingerprint ||
    !manifest.database?.counts ||
    typeof manifest.sentinel?.title !== 'string' ||
    typeof manifest.sentinel?.publicId !== 'string' ||
    !Array.isArray(manifest.scenarios) ||
    manifest.scenarios.length !== 12 ||
    canonical(manifest.scenarios.map((x) => x.name)) !== canonical(names)
  )
    throw new Error(
      'Invalid manifest: require existing perf:v1 dataset with 50,000 jobs and 12 search criteria',
    );
  for (const scenario of manifest.scenarios) {
    if (
      !Number.isSafeInteger(scenario.pageNumber) ||
      scenario.pageNumber < 1 ||
      !scenario.filter ||
      typeof scenario.filter !== 'object'
    )
      throw new Error('Invalid manifest scenario');
    for (const [key, value] of Object.entries(scenario.filter)) {
      if (key === 'title' && typeof value === 'string') continue;
      if (
        ['skillIds', 'categoryIds'].includes(key) &&
        Array.isArray(value) &&
        value.length &&
        value.every((x) => Number.isSafeInteger(x) && x > 0)
      )
        continue;
      if (
        ['budgetMin', 'budgetMax'].includes(key) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0
      )
        continue;
      throw new Error('Invalid manifest filter');
    }
  }
  return manifest;
}
export function verifyDatabase(
  manifest: K6Manifest,
  database: DatabaseSnapshot,
  apiDatabase: DatabaseSnapshot,
) {
  if (
    manifest.database.fingerprint !== database.fingerprint ||
    database.fingerprint !== apiDatabase.fingerprint
  )
    throw new Error(
      'API_DATABASE_URL, PERF_DATABASE_URL and manifest identify different databases',
    );
  if (
    canonical(manifest.database.counts) !== canonical(database.counts) ||
    canonical(database.counts) !== canonical(apiDatabase.counts)
  )
    throw new Error('Database counts differ from the seeded manifest');
}

// Hash content, not just counts: an UPDATE must invalidate the comparison too.
// Fixed table/key names; each table digest is deterministic regardless of indexes.
export async function inspectData(pool: Pool) {
  const signatures: Record<string, string> = {};
  const client = await pool.connect();
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    for (const [table, key] of [
      ['job', 'id'],
      ['job_skill', 'job_id, skill_id'],
      ['job_applicant', 'id'],
      ['category', 'id'],
      ['skill', 'id'],
      ['arrangement', 'id'],
    ]) {
      const result = await client.query<{ digest: string }>(
        `SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY ${key}), '')) AS digest FROM "${table}" t`,
      );
      signatures[table] = result.rows[0].digest;
    }
    const ids = Array.from({ length: 50000 }, (_, i) => perfId(`job:${i}`));
    const result = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM job WHERE public_id = ANY($1::text[])',
      [ids],
    );
    if (result.rows[0].count !== 50000)
      throw new Error(
        'Seeded 50,000 benchmark jobs are not all present; do not seed automatically',
      );
    await client.query('COMMIT');
    return {
      dataHash: hash(signatures),
      tableDigests: signatures,
      benchmarkJobs: result.rows[0].count,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function preflightApi(options: {
  apiBaseUrl: string;
  token: string;
  timeoutMs: number;
  manifest: K6Manifest;
  // Passed as a callback so integration tests exercise real HTTP without a DB.
  getPage: (scenario: Scenario) => Promise<unknown>;
}) {
  const get = async (query: string) => {
    const observed = await request(
      `${options.apiBaseUrl}/api/job?${query}`,
      options.token,
      options.timeoutMs,
    );
    if (observed.status === 401 || observed.status === 403)
      throw new TokenError(
        `HTTP ${observed.status}: authentication/permission failed; provide a valid ACCESS_TOKEN`,
      );
    if (observed.status !== 200)
      throw new Error(
        `API preflight failed: HTTP ${observed.status}${observed.timeout ? ' timeout' : ''}`,
      );
    return observed.body;
  };
  const sentinel = (await get(
    new URLSearchParams({
      title: options.manifest.sentinel.title,
      pageSize: '20',
      pageNumber: '1',
    }).toString(),
  )) as { items?: { publicId?: string }[] } | null;
  if (
    !Array.isArray(sentinel?.items) ||
    !sentinel.items.some(
      (x) => x.publicId === options.manifest.sentinel.publicId,
    )
  )
    throw new Error(
      'Seed sentinel missing through API; verify the API process uses API_DATABASE_URL',
    );
  const queries = [];
  for (const scenario of options.manifest.scenarios) {
    const expected: unknown = JSON.parse(
      JSON.stringify(await options.getPage(scenario)),
    );
    const query = scenarioQuery(scenario, 20);
    const observed = await get(query);
    if (!validPage(observed, expected))
      throw new Error(
        `API payload/filter disagrees with actual repository: ${scenario.name}`,
      );
    queries.push({ name: scenario.name, query, expected });
  }
  return queries;
}
