import { hash as bcryptHash, compare } from 'bcrypt';
import {
  prepareApplicants,
  ApplicantRow,
  ApplicantStore,
} from './k6-applicants';
import { buildCases, aggregatePoints } from './k6-support';
import {
  buildOptions,
  sessionFromLogin,
  thinkTimeSeconds,
} from './k6/workload';
import { scenarios } from './scenarios';
import { runK6, prepareK6Files, createK6Output } from './k6-process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const criteria = scenarios(
  Array.from({ length: 10 }, (_, i) => i + 1),
  Array.from({ length: 30 }, (_, i) => i + 1),
);
const password = 'test-password-private';
it('redacts credentials split across process-output chunks before displaying them', () => {
  let text = '';
  const output = createK6Output(
    (value) => {
      text += value;
    },
    [password],
  );
  output.write(Buffer.from('login test-password-'));
  expect(text).toBe('');
  output.write(
    Buffer.from('private\nhttp_reqs 24\nBearer eyJheader.payload.signature'),
  );
  output.end();
  expect(text).toContain('http_reqs 24');
  expect(text).not.toContain(password);
  expect(text).not.toContain('eyJheader.payload.signature');
});
it('prepares private config/account files for direct k6 without persisting credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'k6-prepare-'));
  try {
    const config = {
      ...buildCases(criteria, 'applicant', true)[0],
      apiBaseUrl: 'http://127.0.0.1:3000',
      queries: [
        { name: 'first-page', query: 'pageSize=20', expected: { items: [] } },
      ],
    };
    const accounts = [
      { email: 'a@perf.fitwork.test', publicId: 'a' },
      { email: 'b@perf.fitwork.test', publicId: 'b' },
    ];
    const [prepared] = await prepareK6Files([config], directory, {
      accounts,
      password,
    });
    expect(JSON.parse(await readFile(prepared.configPath, 'utf8'))).toEqual(
      config,
    );
    expect(JSON.parse(await readFile(prepared.accountsPath, 'utf8'))).toEqual(
      accounts,
    );
    for (const path of [prepared.configPath, prepared.accountsPath]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(await readFile(path, 'utf8')).not.toContain(password);
    }
    expect(prepared.command).toContain('k6 run');
    expect(prepared.command).not.toContain(password);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
function account(
  email: string,
  passwordHashed: string,
  overrides: Partial<ApplicantRow> = {},
): ApplicantRow {
  return {
    id: 1,
    publicId: email,
    email,
    passwordHashed,
    isActive: true,
    role: 'ROLE_APPLICANT',
    userType: 'APPLICANT',
    applicantProfile: { id: 1 },
    ...overrides,
  };
}
it('selects distinct active seed applicants with a verified known password and seeds only missing identities without resets', async () => {
  const correct = await bcryptHash(password, 4);
  const wrong = await bcryptHash('other-password', 4);
  const rows = [
    account('z-applicant@seed.fitwork.test', correct),
    account('changed@seed.fitwork.test', wrong, { id: 2 }),
    account('company@seed.fitwork.test', correct, {
      id: 3,
      userType: 'COMPANY',
      role: 'ROLE_COMPANY',
    }),
    account('inactive@seed.fitwork.test', correct, { id: 4, isActive: false }),
    account('real@example.com', correct, { id: 5 }),
  ];
  const original = JSON.stringify(rows);
  const store: ApplicantStore = {
    list: () => Promise.resolve(rows),
    create: (data) => {
      const added = data.map((value, i) =>
        account(value.email, value.passwordHashed, {
          publicId: value.publicId,
          id: rows.length + i + 1,
        }),
      );
      rows.push(...added);
      return Promise.resolve(added);
    },
  };
  const result = await prepareApplicants(store, 3, password, true);
  expect(result.accounts).toHaveLength(3);
  expect(new Set(result.accounts.map((x) => x.email)).size).toBe(3);
  expect(result.reused).toBe(1);
  expect(result.created).toBe(2);
  expect(JSON.stringify(rows.slice(0, 5))).toBe(original);
  expect(result.accounts[0].email).toBe('k6-applicant-0001@perf.fitwork.test');
  expect(await compare(password, rows[5].passwordHashed)).toBe(true);
  const again = await prepareApplicants(store, 3, password, true);
  expect(again.created).toBe(0);
  expect(again.accounts).toEqual(result.accounts);
  expect(again.identitiesHash).toBe(result.identitiesHash);
  expect(JSON.stringify(result)).not.toContain(password);
  expect(JSON.stringify(result)).not.toContain(correct);
});
it('rejects missing or duplicated applicant identities before starting k6 or writing artifacts', async () => {
  const config = {
    ...buildCases(criteria, 'applicant', true)[0],
    apiBaseUrl: 'http://127.0.0.1:1',
    queries: [],
  };
  const one = { email: 'one@perf.fitwork.test', publicId: 'one' };
  const two = { email: 'two@perf.fitwork.test', publicId: 'two' };
  for (const pool of [
    undefined,
    { accounts: [one], password },
    { accounts: [one, one], password },
    { accounts: [one, { ...two, publicId: one.publicId }], password },
    { accounts: [one, two], password: '' },
  ]) {
    await expect(
      runK6(
        config,
        '/path-that-must-not-be-written',
        '',
        new AbortController().signal,
        [],
        pool,
      ),
    ).rejects.toThrow(/applicant account pool/i);
  }
});
it('refuses insufficient accounts with seeding disabled and never alters mismatching/inactive reserved accounts', async () => {
  const hashed = await bcryptHash('other-password', 4);
  const rows = [account('k6-applicant-0001@perf.fitwork.test', hashed)];
  const store: ApplicantStore = {
    list: () => Promise.resolve(rows),
    create: (data) => {
      const added = data.map((value) =>
        account(value.email, value.passwordHashed, {
          publicId: value.publicId,
        }),
      );
      rows.push(...added);
      return Promise.resolve(added);
    },
  };
  await expect(prepareApplicants(store, 1, password, false)).rejects.toThrow(
    /not enough/i,
  );
  expect(rows).toHaveLength(1);
  const result = await prepareApplicants(store, 1, password, true);
  expect(result.accounts[0].email).toBe('k6-applicant-0002@perf.fitwork.test');
  expect(rows[0].passwordHashed).toBe(hashed);
});
it('builds sequential normal applicant loads at 300/500 VUs with think time and a small smoke', () => {
  const full = buildCases(criteria, 'applicant', false);
  expect(full.map((x) => x.vus)).toEqual([300, 500]);
  expect(buildOptions(full[0]).scenarios.search).toMatchObject({
    executor: 'constant-vus',
    vus: 300,
    duration: '70000ms',
  });
  expect(full[1].startMs).toBeGreaterThanOrEqual(80000);
  expect(full[0]).toMatchObject({ thinkMinSeconds: 1, thinkMaxSeconds: 3 });
  const smoke = buildCases(criteria, 'applicant', true);
  expect(smoke).toHaveLength(1);
  expect(buildOptions(smoke[0]).scenarios.search).toMatchObject({
    executor: 'per-vu-iterations',
    vus: 2,
    iterations: 12,
  });
  expect([0, 1, 2].map((i) => thinkTimeSeconds(i, 1, 3))).toEqual([1, 2, 3]);
});
it('accepts only the correct applicant identity and a usable access-token expiry from API login', () => {
  const now = 100000;
  const token = (claims: unknown) =>
    `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  const decode = (value: string) => Buffer.from(value, 'base64url').toString();
  const valid = {
    accessToken: token({
      sub: 'applicant-id',
      role: 'ROLE_APPLICANT',
      exp: 1000,
    }),
    expiresIn: 900,
  };
  expect(sessionFromLogin(valid, 'applicant-id', now, decode)).toEqual({
    token: valid.accessToken,
    expiresAtMs: 1000000,
  });
  expect(sessionFromLogin(valid, 'wrong-id', now, decode)).toBeNull();
  expect(
    sessionFromLogin(
      {
        ...valid,
        accessToken: token({
          sub: 'applicant-id',
          role: 'ROLE_COMPANY',
          exp: 1000,
        }),
      },
      'applicant-id',
      now,
      decode,
    ),
  ).toBeNull();
  expect(
    sessionFromLogin(
      {
        ...valid,
        accessToken: token({
          sub: 'applicant-id',
          role: 'ROLE_APPLICANT',
          exp: 100,
        }),
      },
      'applicant-id',
      now,
      decode,
    ),
  ).toBeNull();
  expect(
    sessionFromLogin({ accessToken: 'bad' }, 'applicant-id', now, decode),
  ).toBeNull();
});
it('reports login separately, requires distinct authenticated VUs and excludes login/think time from search latency', () => {
  const config = {
    ...buildCases(criteria, 'applicant', false)[0],
    vus: 2,
    warmupMs: 0,
    durationMs: 1000,
  };
  const p = (metric: string, value: number, tags: Record<string, string>) => ({
    type: 'Point',
    metric,
    data: {
      value,
      time: '2026-10-10T00:00:01Z',
      tags: { epoch: '1791590400000', ...tags },
    },
  });
  const points = [
    p('job_login_started', 1, { vu: '1' }),
    p('job_login_sample', 900, {
      vu: '1',
      status: '200',
      valid: 'true',
      ended: '9000',
    }),
    p('job_login_started', 1, { vu: '2' }),
    p('job_login_sample', 800, {
      vu: '2',
      status: '200',
      valid: 'true',
      ended: '9000',
    }),
    p('job_search_started', 1, { phase: 'measure', criterion: 'first-page' }),
    p('job_search_sample', 20, {
      phase: 'measure',
      criterion: 'first-page',
      status: '200',
      valid: 'true',
      ended: '920',
    }),
    p('job_session_ended', 1920, {}),
  ];
  const result = aggregatePoints(points, config, true);
  expect(result.total.latency.p95Ms).toBe(20);
  expect(result.total.elapsedMs).toBe(1920);
  expect(result.login).toMatchObject({
    requests: 2,
    successful: 2,
    latency: { p95Ms: 900 },
    elapsedMs: 9000,
  });
  expect(result.authenticatedVus).toBe(2);
  expect(result.targetLoadMet).toBe(true);
  expect(
    aggregatePoints(points.slice(0, 2).concat(points.slice(4)), config, true)
      .targetLoadMet,
  ).toBe(false);
});
