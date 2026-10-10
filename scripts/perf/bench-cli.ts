import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Pool } from 'pg';
import { createPrisma, inspectDatabase, requiredEnv } from './database';
import { request, runCase, TokenError, assertTokenLifetime } from './http';
import { captureAndExplain } from './explain';
import { benchmarkSkills } from './cache';
import { BenchmarkReport, renderReport } from './report';
import { Scenario, scenarioQuery } from './scenarios';
import { readCacheMetrics } from './metrics';
import { PrismaService } from '../../src/shared/infrastructure/database/prisma.service';
import { JobRepository } from '../../src/modules/job/infrastructure/job.repo';

type Manifest = {
  namespace: string;
  database: { fingerprint: string };
  scenarios: Scenario[];
  sentinel: { publicId: string; title: string };
};
async function main() {
  const opts = new Command()
    .option(
      '--manifest <path>',
      'seed manifest',
      '.tmp/job-benchmark/manifest.json',
    )
    .option('--output <path>', 'report directory', '.tmp/job-benchmark')
    .option('--page-size <number>', 'page size', '20')
    .option('--concurrency <list>', 'fixed concurrency levels', '1,10,50')
    .option('--warmup <seconds>', 'warm-up per case', '5')
    .option('--duration <seconds>', 'measurement per case', '30')
    .option('--timeout <seconds>', 'request timeout', '10')
    .option('--cache-miss-samples <number>', 'serial Redis miss samples', '100')
    .parse()
    .opts<Record<string, string>>();
  const parameters = {
    pageSize: Number(opts.pageSize),
    concurrencies: opts.concurrency.split(',').map(Number),
    warmupMs: Number(opts.warmup) * 1000,
    durationMs: Number(opts.duration) * 1000,
    timeoutMs: Number(opts.timeout) * 1000,
  };
  if (
    !Number.isSafeInteger(parameters.pageSize) ||
    parameters.pageSize < 1 ||
    parameters.pageSize > 1000 ||
    !parameters.concurrencies.length ||
    parameters.concurrencies.some(
      (x) => !Number.isSafeInteger(x) || x < 1 || x > 1000,
    ) ||
    !Number.isFinite(parameters.warmupMs) ||
    parameters.warmupMs < 0 ||
    !Number.isFinite(parameters.durationMs) ||
    parameters.durationMs <= 0 ||
    !Number.isSafeInteger(parameters.timeoutMs) ||
    parameters.timeoutMs <= 0 ||
    !Number.isSafeInteger(Number(opts.cacheMissSamples)) ||
    Number(opts.cacheMissSamples) < 1
  )
    throw new Error('Invalid benchmark options');
  const token = requiredEnv('ACCESS_TOKEN');
  const apiBaseUrl = requiredEnv('API_BASE_URL');
  const url = requiredEnv('PERF_DATABASE_URL');
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
  });
  const apiPool = new Pool({
    connectionString: requiredEnv('API_DATABASE_URL'),
    connectionTimeoutMillis: 10_000,
  });
  const prisma = createPrisma(url, true);
  const report: BenchmarkReport = {
    startedAt: new Date().toISOString(),
    apiBaseUrl,
    parameters,
    search: [],
  };
  const output = resolve(opts.output);
  const basename = `baseline-${report.startedAt.replace(/[:.]/g, '-')}`;
  const save = async () => {
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, `${basename}.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
    await writeFile(resolve(output, `${basename}.md`), renderReport(report));
  };
  try {
    const manifest = JSON.parse(
      await readFile(opts.manifest, 'utf8'),
    ) as Manifest;
    if (manifest.namespace !== 'perf:v1' || !manifest.scenarios?.length)
      throw new Error('Invalid perf:v1 manifest');
    assertTokenLifetime(
      token,
      (manifest.scenarios.length + 1) *
        parameters.concurrencies.length *
        (parameters.warmupMs + parameters.durationMs + parameters.timeoutMs) +
        Number(opts.cacheMissSamples) * parameters.timeoutMs +
        120_000,
    );
    report.database = await inspectDatabase(pool);
    const apiDatabase = await inspectDatabase(apiPool);
    if (
      report.database.fingerprint !== manifest.database.fingerprint ||
      report.database.fingerprint !== apiDatabase.fingerprint
    )
      throw new Error(
        'API_DATABASE_URL, PERF_DATABASE_URL and seed manifest do not identify the same database',
      );
    if (process.env.CACHE_METRICS_FILE) {
      const evidencePath =
        process.env.API_EVIDENCE_FILE ??
        resolve(process.env.CACHE_METRICS_FILE, '..', 'api-evidence.json');
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as {
        pid: number;
        apiBaseUrl: string;
        database: { fingerprint: string };
        redisFingerprint: string;
      };
      const metricFile = JSON.parse(
        await readFile(process.env.CACHE_METRICS_FILE, 'utf8'),
      ) as { pid: number };
      if (
        evidence.pid !== metricFile.pid ||
        evidence.database.fingerprint !== report.database.fingerprint ||
        new URL(evidence.apiBaseUrl).origin !== new URL(apiBaseUrl).origin ||
        evidence.redisFingerprint !==
          createHash('sha256').update(requiredEnv('REDIS_URL')).digest('hex')
      )
        throw new Error(
          'Benchmark API process evidence does not match database, Redis, URL or metrics file',
        );
    }
    await readCacheMetrics(); // Fail fast before the long search matrix if telemetry is missing.
    const sentinel = await request(
      new URL(
        `/api/job?${new URLSearchParams({ title: manifest.sentinel.title })}`,
        apiBaseUrl,
      ).toString(),
      token,
      parameters.timeoutMs,
    );
    if (sentinel.status !== 200)
      throw new TokenError(
        `API preflight HTTP ${sentinel.status}; verify API_BASE_URL and ACCESS_TOKEN (token may be expired).`,
      );
    const sentinelPayload = sentinel.body as { items?: { publicId: string }[] };
    if (
      !sentinelPayload.items?.some(
        (x) => x.publicId === manifest.sentinel.publicId,
      )
    )
      throw new Error(
        'Seed sentinel not found through API; confirm the API process uses API_DATABASE_URL',
      );
    const repo = new JobRepository(prisma as PrismaService);
    for (const scenario of manifest.scenarios) {
      const expected = await repo.getListJobs(
        scenario.pageNumber,
        parameters.pageSize,
        scenario.filter,
      );
      if (expected.isErr()) throw expected.error;
      const observed = await request(
        new URL(
          `/api/job?${scenarioQuery(scenario, parameters.pageSize)}`,
          apiBaseUrl,
        ).toString(),
        token,
        parameters.timeoutMs,
      );
      const page = observed.body as {
        items?: { publicId: string }[];
        totalPages?: number;
      };
      if (
        observed.status !== 200 ||
        page.totalPages !== expected.value.totalPages ||
        JSON.stringify(page.items?.map((x) => x.publicId)) !==
          JSON.stringify(expected.value.items.map((x) => x.publicId))
      )
        throw new Error(
          `API and actual repository disagree for ${scenario.name}: HTTP ${observed.status}`,
        );
    }
    report.databaseVerified = {
      source:
        'API process configuration attestation (API_DATABASE_URL), database identity, seed sentinel and all scenario pages',
      fingerprint: apiDatabase.fingerprint,
      sentinel: manifest.sentinel.publicId,
      scenariosMatch: true,
    };
    for (const scenario of manifest.scenarios) {
      const endpoint = new URL(
        `/api/job?${scenarioQuery(scenario, parameters.pageSize)}`,
        apiBaseUrl,
      ).toString();
      for (const concurrency of parameters.concurrencies) {
        console.log(`Search ${scenario.name} concurrency=${concurrency}`);
        const result = await runCase(
          () => request(endpoint, token, parameters.timeoutMs),
          {
            concurrency,
            warmupMs: parameters.warmupMs,
            durationMs: parameters.durationMs,
          },
        );
        report.search.push({ name: scenario.name, ...result });
        await save();
        if (result.authError) throw new TokenError(result.authError);
        if (result.error) throw new Error(result.error);
      }
    }
    console.log(
      'Capturing actual repository SQL and EXPLAIN (outside HTTP timing)',
    );
    report.sql = await captureAndExplain(
      prisma,
      pool,
      manifest.scenarios,
      parameters.pageSize,
    );
    await save();
    console.log('Benchmarking skills Redis misses and hits');
    report.skills = await benchmarkSkills({
      apiBaseUrl,
      token,
      missSamples: Number(opts.cacheMissSamples),
      ...parameters,
    });
    if (report.skills.error) throw new Error(report.skills.error);
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Benchmark failed';
    process.exitCode = 1;
    console.error(report.error);
  } finally {
    report.completedAt = new Date().toISOString();
    await save();
    await prisma.$disconnect();
    await pool.end();
    await apiPool.end();
    console.log(`Reports: ${resolve(output, basename)}.{json,md}`);
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 1;
});
