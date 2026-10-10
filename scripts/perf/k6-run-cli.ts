import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Pool } from 'pg';
import { config as loadDotEnv } from 'dotenv';
import { DEFAULT_SEED_PASSWORD } from '../../prisma/seed/seed-demo';
import {
  applicantStore,
  prepareApplicants,
  loginApplicant,
} from './k6-applicants';
import { createPrisma, inspectDatabase, requiredEnv } from './database';
import { captureAndExplain } from './explain';
import { JobRepository } from '../../src/modules/job/infrastructure/job.repo';
import { PrismaService } from '../../src/shared/infrastructure/database/prisma.service';
import {
  assertJwt,
  buildCases,
  compareReports,
  hash,
  redact,
  interruptibleStep,
} from './k6-support';
import {
  inspectData,
  parseManifest,
  preflightApi,
  verifyDatabase,
} from './k6-preflight';
import { K6Report, renderK6Report } from './k6-report';
import { runK6, prepareK6Files } from './k6-process';

async function main() {
  const opts = new Command()
    .option('--profile <profile>', 'all|matrix|mixed|applicant', 'all')
    .option('--vus <list>', 'applicant VU levels (1..500)', '300,500')
    .option('--no-seed-accounts', 'refuse to create missing applicant accounts')
    .option(
      '--prepare-only',
      'prepare applicant files/commands after preflight; do not run HTTP workload',
      false,
    )
    .option(
      '--smoke',
      'one request per criterion, plus a short mixed run',
      false,
    )
    .option(
      '--manifest <path>',
      'existing seeded manifest',
      '.tmp/job-benchmark/manifest.json',
    )
    .option(
      '--output <directory>',
      'parent directory for unique run artifacts',
      '.tmp/job-benchmark/k6',
    )
    .option('--label <label>', 'experiment label', 'before-index')
    .option('--baseline <report.json>', 'compare against a matching k6 report')
    .parse()
    .opts<{
      profile: string;
      smoke: boolean;
      manifest: string;
      output: string;
      label: string;
      baseline?: string;
      vus: string;
      seedAccounts: boolean;
      prepareOnly: boolean;
    }>();
  const isApplicant = opts.profile === 'applicant';
  if (opts.prepareOnly && (!isApplicant || opts.baseline))
    throw new Error(
      '--prepare-only requires profile applicant and cannot compare a baseline',
    );
  if (isApplicant) {
    // This profile follows the running server's local config; benchmark profiles
    // matrix/mixed retain their explicit-environment contract.
    loadDotEnv({ quiet: true });
    if (!process.env.PERF_DATABASE_URL && process.env.DATABASE_URL)
      process.env.PERF_DATABASE_URL = process.env.DATABASE_URL;
    if (
      !process.env.API_DATABASE_URL &&
      (process.env.DATABASE_URL || process.env.PERF_DATABASE_URL)
    )
      process.env.API_DATABASE_URL =
        process.env.DATABASE_URL || process.env.PERF_DATABASE_URL;
    process.env.API_BASE_URL ??= `http://127.0.0.1:${process.env.PORT || '3000'}`;
  }
  const names = [
    'API_BASE_URL',
    ...(!isApplicant ? ['ACCESS_TOKEN'] : []),
    'PERF_DATABASE_URL',
    'API_DATABASE_URL',
  ];
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new Error(
      `Missing required environment: ${missing.join(', ')}. Configure the listed variables before running; API must already be running.`,
    );
  let token = isApplicant ? '' : requiredEnv('ACCESS_TOKEN');
  const applicantPassword = isApplicant
    ? (process.env.K6_APPLICANT_PASSWORD ??
      process.env.SEED_PASSWORD ??
      DEFAULT_SEED_PASSWORD)
    : '';
  const apiUrl = new URL(requiredEnv('API_BASE_URL'));
  if (
    !['http:', 'https:'].includes(apiUrl.protocol) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash ||
    (apiUrl.pathname !== '/' && apiUrl.pathname !== '')
  )
    throw new Error(
      'API_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment',
    );
  const dbUrl = requiredEnv('PERF_DATABASE_URL');
  const apiDbUrl = requiredEnv('API_DATABASE_URL');
  const secrets = [token, dbUrl, apiDbUrl, applicantPassword];
  for (const connection of [dbUrl, apiDbUrl]) {
    const parsed = new URL(connection);
    if (parsed.password)
      secrets.push(parsed.password, decodeURIComponent(parsed.password));
  }
  const manifest = parseManifest(await readFile(opts.manifest, 'utf8'));
  const cases = buildCases(
    manifest.scenarios,
    opts.profile,
    opts.smoke,
    opts.vus.split(',').map(Number),
  );
  const last = cases[cases.length - 1];
  // Conservative budget includes drain, per-process startup and serial API preflight.
  if (!isApplicant)
    assertJwt(
      token,
      last.startMs +
        last.warmupMs +
        last.durationMs +
        last.gracefulStopMs +
        cases.length * 5000 +
        190000,
    );
  let k6Version: string;
  try {
    k6Version = execFileSync('k6', ['version'], {
      encoding: 'utf8',
      timeout: 10000,
    }).trim();
  } catch {
    throw new Error(
      'k6 is required on PATH (version >= 0.57 with TypeScript and execution.test.abort support)',
    );
  }
  const versionMatch = /k6 v(\d+)\.(\d+)/.exec(k6Version);
  if (
    !versionMatch ||
    (Number(versionMatch[1]) === 0 && Number(versionMatch[2]) < 57)
  )
    throw new Error('k6 >= 0.57 is required');
  // The legacy --summary-export format serializes setup_data, which now holds
  // applicant JWTs. Applicant runs must use the new format that omits that data.
  if (
    isApplicant &&
    (Number(versionMatch[1]) === 0 ||
      (Number(versionMatch[1]) === 1 && Number(versionMatch[2]) < 5))
  )
    throw new Error(
      'Applicant runs require k6 >= 1.5 for safe summary export without setup tokens',
    );
  const startedAt = new Date().toISOString();
  const slug = opts.label.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'run';
  const output = resolve(
    opts.output,
    `${slug}-${startedAt.replace(/[:.]/g, '-')}`,
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const abortController = new AbortController();
  const interrupt = () => abortController.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const report: K6Report = {
    schemaVersion: 1,
    label: opts.label,
    startedAt,
    apiBaseUrl: apiUrl.origin,
    versions: { node: process.version, k6: k6Version },
    parameters: {
      profile: opts.profile,
      smoke: opts.smoke,
      pageSize: 20,
      cases,
    },
    completed: false,
    results: [],
    artifactDirectory: output,
    workloadHash: hash({
      version: 1,
      latency: 'k6-response.timings.duration-http200-valid',
      mixed: 'global-iteration-modulo',
      pageSize: 20,
      scenarios: manifest.scenarios,
      cases,
      scriptHash: hash(
        await readFile(resolve('scripts/perf/k6/job-search.js'), 'utf8'),
      ),
      helperHash: hash(
        await readFile(resolve('scripts/perf/k6/workload.ts'), 'utf8'),
      ),
      measurementHash: hash(
        await readFile(resolve('scripts/perf/k6-support.ts'), 'utf8'),
      ),
    }),
  };
  try {
    report.commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    report.dirty = Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    );
  } catch {
    /* Provenance remains explicitly unavailable outside Git. */
  }
  const save = async () => {
    const json = resolve(output, 'report.json');
    await writeFile(
      json + '.tmp',
      JSON.stringify(
        report,
        (_key: string, value: unknown) =>
          typeof value === 'string'
            ? redact(value, [token, dbUrl, apiDbUrl])
            : value,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    await rename(json + '.tmp', json);
    await writeFile(
      resolve(output, 'report.md'),
      redact(renderK6Report(report), [token, dbUrl, apiDbUrl]),
      { mode: 0o600 },
    );
  };
  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  const apiPool = new Pool({
    connectionString: apiDbUrl,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  });
  const prisma = createPrisma(dbUrl, true);
  try {
    report.database = await inspectDatabase(pool);
    verifyDatabase(manifest, report.database, await inspectDatabase(apiPool));
    report.versions.postgres = String(
      (report.database.identity as Record<string, unknown>).version,
    );
    Object.assign(report, await inspectData(pool));
    let applicantSessions:
      | { accounts: { email: string; publicId: string }[]; password: string }
      | undefined;
    if (isApplicant) {
      const selected = await interruptibleStep(abortController.signal, () =>
        prepareApplicants(
          applicantStore(prisma),
          Math.max(...cases.map((c) => c.vus)),
          applicantPassword,
          opts.seedAccounts,
        ),
      );
      const { accounts, ...accountSummary } = selected;
      report.accounts = { ...accountSummary, count: accounts.length };
      report.workloadHash = hash({
        workload: report.workloadHash,
        applicantIdentities: selected.identitiesHash,
      });
      console.log(
        `Applicants: ${accounts.length} distinct accounts (${selected.reused} reused, ${selected.created} created).`,
      );
      applicantSessions = { accounts, password: applicantPassword };
      token = await interruptibleStep(abortController.signal, () =>
        loginApplicant(apiUrl.origin, accounts[0], applicantPassword),
      );
      secrets.push(token);
      assertJwt(token, 140000); // Enough for the serial query/sentinel preflight.
    }
    const repo = new JobRepository(prisma as PrismaService);
    const queries = await preflightApi({
      apiBaseUrl: apiUrl.origin,
      token,
      timeoutMs: 10000,
      manifest,
      getPage: async (scenario) => {
        const expected = await repo.getListJobs(
          scenario.pageNumber,
          20,
          scenario.filter,
        );
        if (expected.isErr())
          throw new Error(`Actual repository failed for ${scenario.name}`);
        return expected.value;
      },
    });
    report.preflight = {
      source:
        'API process DB attestation, identity/counts, seeded sentinel, full payloads vs actual repository',
      sentinel: manifest.sentinel.publicId,
      criteria: queries.length,
    };
    await save();
    if (opts.prepareOnly) {
      const prepared = await prepareK6Files(
        cases.map((current) => ({
          ...current,
          apiBaseUrl: apiUrl.origin,
          queries,
        })),
        output,
        applicantSessions!,
      );
      report.preparedOnly = true;
      console.log('Prepared only: no HTTP workload or EXPLAIN was run.');
      console.log(
        'Export K6_APPLICANT_PASSWORD with the matching seed password, then run each command sequentially:',
      );
      for (const entry of prepared) console.log(entry.command);
      return;
    }
    for (let i = 0; i < cases.length; i++) {
      if (abortController.signal.aborted)
        throw new Error('Run interrupted; completed case artifacts retained');
      const current = cases[i];
      const remaining = cases
        .slice(i)
        .reduce(
          (n, c) => n + c.warmupMs + c.durationMs + c.gracefulStopMs + 5000,
          0,
        );
      if (!isApplicant) assertJwt(token, remaining);
      console.log(`[${i + 1}/${cases.length}] ${current.id}`);
      const result = await runK6(
        { ...current, apiBaseUrl: apiUrl.origin, queries },
        output,
        token,
        abortController.signal,
        secrets,
        applicantSessions,
      );
      report.results.push(result.report);
      await save();
      if (result.authStatus)
        throw new Error(
          `HTTP ${result.authStatus}: authentication/permission failed; completed artifacts retained, ${isApplicant ? 'check applicant credentials, active status and permissions' : 'provide a valid ACCESS_TOKEN'}`,
        );
      if (!result.report.complete)
        throw new Error(
          `k6 case ${current.id} incomplete (exit ${result.exitCode}, malformed/missing metric lines ${result.truncatedLines}); inspect sanitized case log`,
        );
    }
    if (abortController.signal.aborted)
      throw new Error('Run interrupted; completed case artifacts retained');
    // All HTTP has stopped before SQL capture/EXPLAIN begins.
    console.log(
      'HTTP complete; capturing actual repository SQL and EXPLAIN separately.',
    );
    report.sql = await interruptibleStep(abortController.signal, () =>
      captureAndExplain(prisma, pool, manifest.scenarios, 20),
    );
    report.databaseAfter = await interruptibleStep(abortController.signal, () =>
      inspectDatabase(pool),
    );
    report.dataHashAfter = (
      await interruptibleStep(abortController.signal, () => inspectData(pool))
    ).dataHash;
    if (
      hash(report.database.counts) !== hash(report.databaseAfter.counts) ||
      report.dataHashAfter !== report.dataHash
    )
      throw new Error(
        'Database data/counts changed during run; verification failed',
      );
    if (hash(report.database.indexes) !== hash(report.databaseAfter.indexes))
      throw new Error(
        'Database indexes changed during run; verification failed',
      );
    report.completed = true;
    report.verified = report.results.every((x) => x.verified);
    report.targetLoadMet = report.results.every(
      (x) => x.targetLoadMet !== false,
    );
    if (opts.baseline) {
      try {
        report.comparison = compareReports(
          JSON.parse(
            await interruptibleStep(abortController.signal, () =>
              readFile(opts.baseline!, 'utf8'),
            ),
          ) as K6Report,
          report,
        );
      } catch (error) {
        if (abortController.signal.aborted) throw error;
        report.comparisonError = redact(
          error instanceof Error ? error.message : 'Comparison failed',
          secrets,
        );
      }
    }
    if (!report.verified || !report.targetLoadMet || report.comparisonError)
      process.exitCode = 1;
  } catch (error) {
    report.completed = false;
    report.error = redact(
      error instanceof Error ? error.message : 'k6 benchmark failed',
      secrets,
    );
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    await save();
    await Promise.allSettled([prisma.$disconnect(), pool.end(), apiPool.end()]);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    console.log(`Report: ${resolve(output, 'report.json')}`);
    if (report.error) console.error(report.error);
  }
}
void main().catch((error: unknown) => {
  // Early failures must never include a supplied token or a database URL.
  const secrets = [
    'ACCESS_TOKEN',
    'PERF_DATABASE_URL',
    'API_DATABASE_URL',
    'DATABASE_URL',
    'K6_APPLICANT_PASSWORD',
    'SEED_PASSWORD',
  ].map((k) => process.env[k] ?? '');
  console.error(
    redact(
      error instanceof Error ? error.message : 'k6 benchmark failed',
      secrets,
    ),
  );
  process.exitCode = 1;
});
