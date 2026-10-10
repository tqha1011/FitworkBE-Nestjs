import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { request, runCase, TokenError, assertTokenLifetime } from './http';

it('rejects a token that expires before the full matrix and tolerates malformed claims for API verification', () => {
  const token = (claims: unknown) =>
    `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
  expect(() =>
    assertTokenLifetime(
      token({ exp: Math.floor(Date.now() / 1000) + 60 }),
      120_000,
    ),
  ).toThrow();
  expect(() =>
    assertTokenLifetime(
      token({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      120_000,
    ),
  ).not.toThrow();
  expect(() => assertTokenLifetime(token(null), 120_000)).not.toThrow();
});

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/slow') return void setTimeout(() => res.end('{}'), 100);
    res.statusCode =
      req.url === '/unauthorized' ? 401 : req.url === '/error' ? 500 : 200;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('keeps HTTP errors and timeouts out of successful latency percentiles', async () => {
  let calls = 0;
  const result = await runCase(
    async () => {
      calls++;
      return request(
        `${base}${calls % 3 === 0 ? '/error' : calls % 3 === 1 ? '/slow' : '/'}`,
        'test',
        15,
      );
    },
    { concurrency: 2, warmupMs: 0, durationMs: 100 },
  );
  expect(result.successful).toBeGreaterThan(0);
  expect(result.errorsByStatus['500']).toBeGreaterThan(0);
  expect(result.timeouts).toBeGreaterThan(0);
  expect(result.latency.samples).toBe(result.successful);
  expect(result.requests).toBe(
    result.successful + result.timeouts + result.errorsByStatus['500'],
  );
});

it('discards warm-up requests from all measured counters', async () => {
  let calls = 0;
  const result = await runCase(
    async () => {
      calls++;
      return request(`${base}/`, 'test', 1000);
    },
    { concurrency: 1, warmupMs: 40, durationMs: 40 },
  );
  expect(result.successful).toBeGreaterThan(0);
  expect(calls).toBeGreaterThan(result.requests);
  expect(result.latency.samples).toBe(result.successful);
});

it('fails clearly on invalid or expired tokens', async () => {
  const result = await runCase(
    () => request(`${base}/unauthorized`, 'test', 1000),
    { concurrency: 2, warmupMs: 0, durationMs: 50 },
  );
  expect(result.authError).toMatch(/401.*token/i);
  expect(result.errorsByStatus['401']).toBeGreaterThan(0);
  expect(result.successful).toBe(0);
  expect(result.latency.p95Ms).toBeNull();
  const expired = `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.x`;
  await expect(request(`${base}/`, expired, 1000)).rejects.toBeInstanceOf(
    TokenError,
  );
});
