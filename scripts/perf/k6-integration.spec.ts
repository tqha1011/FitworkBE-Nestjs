import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCases } from './k6-support';
import { runK6, prepareK6Files } from './k6-process';
import { K6Report, renderK6Report } from './k6-report';
import { preflightApi, verifyDatabase, K6Manifest } from './k6-preflight';
import { scenarioQuery, scenarios } from './scenarios';

const criteria = scenarios(
  Array.from({ length: 10 }, (_, i) => i + 1),
  Array.from({ length: 30 }, (_, i) => i + 1),
);
const item = {
  publicId: 'sentinel',
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
const pageFor = (pageNumber = 1) => ({
  items: [item],
  totalPages: 10000,
  pageNumber,
  pageSize: 20,
  hasPrevious: pageNumber > 1,
  hasNext: true,
});
const database = {
  identity: { system_identifier: null },
  fingerprint: 'db',
  indexes: [],
  counts: { jobs: 50000 },
};
const manifest: K6Manifest = {
  namespace: 'perf:v1',
  requestedJobs: 50000,
  database,
  scenarios: criteria,
  sentinel: { publicId: 'sentinel', title: 'unique sentinel' },
};
let server: Server;
let base: string;
let mode = 'ok';
let directory: string;
const applicantPassword = 'private-k6-fixture-password';
const fixtureAccounts = Array.from({ length: 500 }, (_, i) => ({
  email: `applicant-${i + 1}@seed.fitwork.test`,
  publicId: `applicant-id-${i + 1}`,
}));
let loginCounts = new Map<string, number>();
let searchedIdentities = new Set<string>();
let requiredApplicants = 0;
let searchBeforeLoginReady = false;
let activeLogins = 0;
let maxActiveLogins = 0;
const fixtureToken = (publicId: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: publicId, role: 'ROLE_APPLICANT', exp: Math.floor(Date.now() / 1000) + (mode === 'short-token' ? 15 : 3600) })).toString('base64url')}.private-token-signature`;
const token = `e30.${Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url')}.secret-signature`;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fitwork-k6 ' "));
  server = createServer((req, res) => {
    if (req.url === '/api/auth/login') {
      let body = '';
      req.on('data', (value: Buffer) => {
        body += value.toString();
      });
      req.on('end', () => {
        const credentials = JSON.parse(body) as {
          email: string;
          password: string;
        };
        const account = fixtureAccounts.find(
          (a) => a.email === credentials.email,
        );
        res.setHeader('Content-Type', 'application/json');
        if (
          !account ||
          credentials.password !== applicantPassword ||
          mode === '401'
        ) {
          res.statusCode = 401;
          return res.end('{}');
        }
        activeLogins++;
        maxActiveLogins = Math.max(maxActiveLogins, activeLogins);
        const sendLogin = () => {
          activeLogins--;
          loginCounts.set(
            account.publicId,
            (loginCounts.get(account.publicId) ?? 0) + 1,
          );
          res.end(
            JSON.stringify({
              accessToken: fixtureToken(account.publicId),
              expiresIn: mode === 'short-token' ? 15 : 3600,
            }),
          );
        };
        if (mode === 'slow-login' && account.email !== fixtureAccounts[0].email)
          setTimeout(sendLogin, requiredApplicants > 2 ? 10 : 250);
        else sendLogin();
      });
      return;
    }
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer eyJhbGciOiJIUzI1NiJ9.')) {
      if (loginCounts.size < requiredApplicants) searchBeforeLoginReady = true;
      const claims = JSON.parse(
        Buffer.from(authorization.split('.')[1], 'base64url').toString(),
      ) as { sub: string };
      searchedIdentities.add(claims.sub);
    }
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const selected = query.get('mode') ?? mode;
    if (selected === 'transport') return req.socket.destroy();
    if (selected === '401' || selected === '500') {
      res.statusCode = Number(selected);
      return res.end('{}');
    }
    const page = pageFor(Number(query.get('pageNumber') ?? 1));
    if (selected === 'wrong-db')
      page.items = [{ ...item, publicId: 'other-database' }];
    if (selected === 'wrong-filter') page.items = [{ ...item, budget: 999 }];
    const send = () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(selected === 'malformed' ? '{' : JSON.stringify(page));
    };
    if (selected === 'slow') setTimeout(send, 200);
    else send();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  mode = 'ok';
  loginCounts = new Map();
  searchedIdentities = new Set();
  requiredApplicants = 0;
  searchBeforeLoginReady = false;
  activeLogins = 0;
  maxActiveLogins = 0;
});

it('preflight rejects DB identity/count mismatch before HTTP and checks sentinel, filters, malformed payload and auth over real HTTP', async () => {
  expect(() =>
    verifyDatabase(manifest, database, { ...database, fingerprint: 'other' }),
  ).toThrow(/different databases/);
  expect(() =>
    verifyDatabase(
      manifest,
      { ...database, counts: { jobs: 49999 } },
      database,
    ),
  ).toThrow(/counts/);
  const options = {
    apiBaseUrl: base,
    token,
    timeoutMs: 1000,
    manifest,
    getPage: (scenario: (typeof criteria)[number]) =>
      Promise.resolve(pageFor(scenario.pageNumber)),
  };
  expect(await preflightApi(options)).toHaveLength(12);
  mode = 'wrong-db';
  await expect(preflightApi(options)).rejects.toThrow(/sentinel/);
  mode = 'wrong-filter';
  await expect(preflightApi(options)).rejects.toThrow(/payload\/filter/);
  mode = 'malformed';
  await expect(preflightApi(options)).rejects.toThrow(/sentinel/);
  mode = '401';
  await expect(preflightApi(options)).rejects.toThrow(/401.*authentication/);
});

let hasK6 = false;
try {
  execFileSync('k6', ['version'], { stdio: 'ignore' });
  hasK6 = true;
} catch {
  /* Optional external binary in CI. */
}
const realK6 = hasK6 ? it : it.skip;
realK6(
  'logs in once per distinct applicant VU and reuses its own token for all 12 queries without credential artifacts',
  async () => {
    mode = 'slow-login';
    requiredApplicants = 2;
    let terminal = '';
    const output = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        terminal += String(chunk);
        return true;
      });
    const config = buildCases(criteria, 'applicant', true)[0];
    const result = await runK6(
      {
        ...config,
        apiBaseUrl: base,
        queries: criteria.map((s) => ({
          name: s.name,
          query: scenarioQuery(s, 20),
          expected: pageFor(s.pageNumber),
        })),
      },
      directory,
      '',
      new AbortController().signal,
      [applicantPassword],
      { accounts: fixtureAccounts.slice(0, 2), password: applicantPassword },
    ).finally(() => output.mockRestore());
    expect(terminal).toContain('http_req_duration');
    expect(terminal).toContain('http_reqs');
    expect(terminal).toContain('checks');
    expect(terminal).toContain('job_search_measured');
    expect(terminal).not.toContain(applicantPassword);
    expect(terminal).not.toContain('private-token-signature');
    expect(result.exitCode).toBe(0);
    expect(searchBeforeLoginReady).toBe(false);
    expect(result.report).toMatchObject({
      verified: true,
      targetLoadMet: true,
      authenticatedVus: 2,
      total: { requests: 24, successful: 24 },
      login: { requests: 2, successful: 2 },
    });
    expect([...loginCounts.values()]).toEqual([1, 1]);
    expect(searchedIdentities.size).toBe(2);
    expect(result.report.criteria).toHaveLength(12);
    const points = (
      await readFile(join(directory, `${config.id}.metrics.jsonl`), 'utf8')
    )
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            type: string;
            metric: string;
            data: { time: string; tags: Record<string, string> };
          },
      );
    const ready = points.find(
      (point) =>
        point.type === 'Point' && point.metric === 'job_login_setup_ended',
    )!;
    const searchPoints = points.filter(
      (point) =>
        point.type === 'Point' && point.metric === 'job_search_started',
    );
    expect(searchPoints).toHaveLength(24);
    expect(
      searchPoints.every(
        (point) => Number(point.data.tags.epoch) >= Date.parse(ready.data.time),
      ),
    ).toBe(true);
    expect(
      points.filter(
        (point) =>
          point.type === 'Point' && point.metric === 'job_search_measured',
      ),
    ).toHaveLength(24);
    for (const file of (await readdir(directory)).filter((f) =>
      f.startsWith(config.id),
    )) {
      const contents = await readFile(join(directory, file), 'utf8');
      expect(contents).not.toContain(applicantPassword);
      expect(contents).not.toContain('private-token-signature');
      expect(contents).not.toMatch(/"Authorization"\s*:\s*"Bearer\s/);
      if (file.endsWith('.summary.json'))
        expect(
          (JSON.parse(contents) as { setup_data?: unknown }).setup_data,
        ).toBeUndefined();
    }
  },
  30000,
);
realK6(
  'runs directly with k6 using prepared account/config files and prints the native summary',
  async () => {
    const config = {
      ...buildCases(criteria, 'applicant', true)[0],
      apiBaseUrl: base,
      queries: criteria.map((s) => ({
        name: s.name,
        query: scenarioQuery(s, 20),
        expected: pageFor(s.pageNumber),
      })),
    };
    const [prepared] = await prepareK6Files([config], directory, {
      accounts: fixtureAccounts.slice(0, 2),
      password: applicantPassword,
    });
    const result = await new Promise<{ code: number | null; text: string }>(
      (resolve, reject) => {
        const child = spawn('sh', ['-c', prepared.command], {
          env: {
            PATH: process.env.PATH,
            K6_APPLICANT_PASSWORD: applicantPassword,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let text = '';
        child.stdout.on('data', (chunk: Buffer) => {
          text += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          text += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, text }));
      },
    );
    expect(result.code).toBe(0);
    expect(result.text).toContain('http_req_duration');
    expect(result.text).toContain('http_reqs');
    expect(result.text).not.toContain(applicantPassword);
    expect(result.text).not.toContain('private-token-signature');
    expect([...loginCounts.values()]).toEqual([1, 1]);
    expect(searchedIdentities.size).toBe(2);
    const summary = await readFile(
      join(directory, `${config.id}.summary.json`),
      'utf8',
    );
    expect(summary).not.toContain(applicantPassword);
    expect(summary).not.toContain('private-token-signature');
    expect(
      (JSON.parse(summary) as { setup_data?: unknown }).setup_data,
    ).toBeUndefined();
  },
  30000,
);
realK6(
  'runs 300 and 500 distinct applicant VUs with real k6 against the local fixture and separate successful login/search metrics',
  async () => {
    for (const original of buildCases(criteria, 'applicant', false)) {
      loginCounts.clear();
      requiredApplicants = original.vus;
      searchBeforeLoginReady = false;
      mode = 'slow-login';
      const config = { ...original, warmupMs: 200, durationMs: 2000 };
      const result = await runK6(
        {
          ...config,
          apiBaseUrl: base,
          queries: criteria.map((s) => ({
            name: s.name,
            query: scenarioQuery(s, 20),
            expected: pageFor(s.pageNumber),
          })),
        },
        directory,
        '',
        new AbortController().signal,
        [applicantPassword],
        { accounts: fixtureAccounts, password: applicantPassword },
      );
      expect(result.exitCode).toBe(0);
      expect(searchBeforeLoginReady).toBe(false);
      expect(maxActiveLogins).toBeLessThanOrEqual(10);
      expect(result.report.authenticatedVus).toBe(original.vus);
      expect(result.report.login.successful).toBe(original.vus);
      expect(result.report.targetLoadMet).toBe(true);
      expect(result.report.verified).toBe(true);
      expect(result.report.total.successful).toBeGreaterThan(0);
      expect([...loginCounts.values()].every((value) => value === 1)).toBe(
        true,
      );
    }
  },
  30000,
);
realK6(
  'refuses short-lived tokens before search instead of logging in again during measurement',
  async () => {
    mode = 'short-token';
    const config = {
      ...buildCases(criteria, 'applicant', true)[0],
      id: 'applicant-short-token',
    };
    const result = await runK6(
      {
        ...config,
        apiBaseUrl: base,
        queries: [{ name: 'first-page', query: '', expected: pageFor() }],
      },
      directory,
      '',
      new AbortController().signal,
      [applicantPassword],
      { accounts: fixtureAccounts.slice(0, 2), password: applicantPassword },
    );
    expect(result.exitCode).not.toBe(0);
    expect(searchedIdentities.size).toBe(0);
    expect(result.report.total.requests).toBe(0);
  },
  30000,
);
realK6(
  'aborts bad applicant credentials and keeps login failures out of search latency',
  async () => {
    const config = {
      ...buildCases(criteria, 'applicant', true)[0],
      id: 'applicant-bad-login',
    };
    const result = await runK6(
      {
        ...config,
        apiBaseUrl: base,
        queries: [{ name: 'first-page', query: '', expected: pageFor() }],
      },
      directory,
      '',
      new AbortController().signal,
      ['wrong-password'],
      { accounts: fixtureAccounts.slice(0, 2), password: 'wrong-password' },
    );
    expect(result.authStatus).toBe(401);
    expect(result.report.login.errorsByStatus['401']).toBeGreaterThan(0);
    expect(result.report.total.successful).toBe(0);
    expect(result.report.total.latency.p95Ms).toBeNull();
    expect(result.report.verified).toBe(false);
  },
  30000,
);
realK6(
  'runs the actual k6 script: one request for each criterion and short mixed traffic, retaining secret-free artifacts',
  async () => {
    const queries = criteria.map((s) => ({
      name: s.name,
      query: scenarioQuery(s, 20),
      expected: pageFor(s.pageNumber),
    }));
    const cases = buildCases(criteria, 'all', true);
    const report: K6Report = {
      schemaVersion: 1,
      label: 'fixture-smoke',
      startedAt: new Date().toISOString(),
      completed: false,
      workloadHash: 'fixture-only',
      apiBaseUrl: base,
      versions: { node: process.version },
      parameters: { profile: 'all', smoke: true, pageSize: 20, cases },
      results: [],
      artifactDirectory: directory,
    };
    for (const config of cases) {
      const result = await runK6(
        { ...config, apiBaseUrl: base, queries },
        directory,
        token,
        new AbortController().signal,
        [token, 'database-password'],
      );
      expect(result.exitCode).toBe(0);
      report.results.push(result.report);
      expect(result.report.verified).toBe(true);
      expect(result.report.total.timeouts).toBe(0);
      if (config.profile === 'matrix')
        expect(result.report.total.requests).toBe(1);
      else {
        expect(result.report.total.requests).toBeGreaterThanOrEqual(49);
        expect(result.report.criteria).toHaveLength(12);
        expect(result.report.targetLoadMet).toBe(true);
        expect(result.report.droppedIterations).toBe(0);
      }
    }
    report.completed = true;
    report.verified = report.results.every((r) => r.verified);
    report.targetLoadMet = report.results.every(
      (r) => r.targetLoadMet !== false,
    );
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(join(directory, 'report.md'), renderK6Report(report));
    expect(await readFile(join(directory, 'report.md'), 'utf8')).toContain(
      'mixed-rps25/page-1000',
    );
    for (const file of await readdir(directory)) {
      const content = await readFile(join(directory, file), 'utf8');
      expect(content).not.toContain(token);
      expect(content).not.toContain('database-password');
      expect(content).not.toMatch(/"Authorization"\s*:\s*"Bearer\s/);
    }
    console.log(`Real k6 smoke artifacts: ${directory}`);
  },
  60000,
);

realK6(
  'retains raw metrics and the partial case result when the process is interrupted',
  async () => {
    const controller = new AbortController();
    const config = {
      ...buildCases(criteria, 'mixed', true)[0],
      id: 'interrupted-mixed',
      warmupMs: 0,
      durationMs: 5000,
    };
    const interrupt = setTimeout(() => controller.abort(), 250);
    try {
      const result = await runK6(
        {
          ...config,
          apiBaseUrl: base,
          queries: criteria.map((s) => ({
            name: s.name,
            query: scenarioQuery(s, 20),
            expected: pageFor(s.pageNumber),
          })),
        },
        directory,
        token,
        controller.signal,
        [token],
      );
      expect(result.report.complete).toBe(false);
      expect(result.report.verified).toBe(false);
      const retained = JSON.parse(
        await readFile(
          join(directory, 'interrupted-mixed.result.json'),
          'utf8',
        ),
      ) as { complete: boolean };
      expect(retained.complete).toBe(false);
      expect(await readdir(directory)).toContain(
        'interrupted-mixed.metrics.jsonl',
      );
    } finally {
      clearTimeout(interrupt);
    }
  },
  20000,
);

realK6(
  'actual k6 timeout, transport error, malformed HTTP 200 and 401 never enter successful latency',
  async () => {
    for (const failure of ['slow', 'transport', 'malformed', '500', '401']) {
      const config = {
        ...buildCases(criteria, 'matrix', true)[0],
        id: `failure-${failure}`,
        timeoutMs: 50,
      };
      const result = await runK6(
        {
          ...config,
          apiBaseUrl: base,
          queries: [
            {
              name: 'first-page',
              query: `mode=${failure}`,
              expected: pageFor(),
            },
          ],
        },
        directory,
        token,
        new AbortController().signal,
        [token],
      );
      expect(result.report.total.successful).toBe(0);
      expect(result.report.total.latency.p95Ms).toBeNull();
      expect(result.report.verified).toBe(false);
      if (failure === 'slow') expect(result.report.total.timeouts).toBe(1);
      if (failure === 'transport')
        expect(result.report.total.transportErrors).toBe(1);
      if (failure === 'malformed')
        expect(result.report.total.payloadFailures).toBe(1);
      if (failure === '500')
        expect(result.report.total.errorsByStatus['500']).toBe(1);
      if (failure === '401') {
        expect(result.authStatus).toBe(401);
        expect(result.exitCode).not.toBe(0);
      }
    }
  },
  30000,
);
