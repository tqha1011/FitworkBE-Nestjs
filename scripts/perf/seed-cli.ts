import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { Pool } from 'pg';
import { seedPerf } from './seed';
import {
  analyze,
  createPrisma,
  inspectDatabase,
  requiredEnv,
} from './database';
import { applicationSlots, perfId, PERF_NAMESPACE } from './dataset';
import { scenarios } from './scenarios';
import { findPerfSentinel } from './sentinel';

async function main() {
  const opts = new Command()
    .option('--jobs <number>', 'benchmark jobs', '50000')
    .option(
      '--manifest <path>',
      'manifest output',
      '.tmp/job-benchmark/manifest.json',
    )
    .parse()
    .opts<{ jobs: string; manifest: string }>();
  const url = requiredEnv('PERF_DATABASE_URL');
  const prisma = createPrisma(url);
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const report = await seedPerf(prisma, {
      jobs: Number(opts.jobs),
      password: process.env.SEED_PASSWORD,
    });
    await analyze(pool);
    const ids = Array.from({ length: Number(opts.jobs) }, (_, i) =>
      perfId(`job:${i}`),
    );
    const appIds = ids.flatMap((_, i) =>
      applicationSlots(i, ids.length).map((slot) =>
        perfId(`application:${i}:${slot}`),
      ),
    );
    const actual = await pool.query<Record<string, unknown>>(
      `SELECT count(*)::int AS jobs,
      count(*) FILTER (WHERE status = 'OPEN')::int AS open,
      count(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
      min(created_at) AS created_min, max(created_at) AS created_max,
      min(due_at) AS deadline_min, max(due_at) AS deadline_max,
      min(budget_in_base_currency)::float8 AS budget_min_vnd,
      max(budget_in_base_currency)::float8 AS budget_max_vnd
      FROM job WHERE public_id = ANY($1::text[])`,
      [ids],
    );
    const distributions: Record<string, unknown> = { ...actual.rows[0] };
    for (const column of ['category_id', 'currency', 'status']) {
      distributions[column] = (
        await pool.query<Record<string, unknown>>(
          `SELECT ${column}, count(*)::int AS count FROM job WHERE public_id = ANY($1::text[]) GROUP BY ${column} ORDER BY ${column}`,
          [ids],
        )
      ).rows;
    }
    distributions.skills = (
      await pool.query<Record<string, unknown>>(
        `SELECT s.skill_id, count(*)::int AS count FROM job_skill s JOIN job j ON j.id = s.job_id WHERE j.public_id = ANY($1::text[]) GROUP BY s.skill_id ORDER BY s.skill_id`,
        [ids],
      )
    ).rows;
    distributions.applications = (
      await pool.query<Record<string, unknown>>(
        `SELECT status, count(*)::int AS count FROM job_applicant WHERE public_id = ANY($1::text[]) GROUP BY status ORDER BY status`,
        [appIds],
      )
    ).rows;
    distributions.applicationsPerJob = (
      await pool.query<Record<string, unknown>>(
        `SELECT applications, count(*)::int AS jobs FROM (SELECT j.id, count(a.id)::int AS applications FROM job j LEFT JOIN job_applicant a ON a.job_id = j.id WHERE j.public_id = ANY($1::text[]) GROUP BY j.id) x GROUP BY applications ORDER BY applications`,
        [ids],
      )
    ).rows;
    distributions.skillsPerJob = (
      await pool.query<Record<string, unknown>>(
        `SELECT skills, count(*)::int AS jobs FROM (SELECT j.id, count(s.skill_id)::int AS skills FROM job j LEFT JOIN job_skill s ON s.job_id = j.id WHERE j.public_id = ANY($1::text[]) GROUP BY j.id) x GROUP BY skills ORDER BY skills`,
        [ids],
      )
    ).rows;
    const sentinel = await findPerfSentinel(prisma, ids);
    const manifest = {
      namespace: PERF_NAMESPACE,
      generatedAt: new Date().toISOString(),
      requestedJobs: ids.length,
      database: await inspectDatabase(pool),
      created: report.created,
      existing: report.existing,
      demo: report.demo,
      references: report.references,
      distributions,
      scenarios: scenarios(
        report.references.refs.categories,
        report.references.refs.skills,
      ),
      sentinel: { publicId: sentinel.publicId, title: sentinel.title },
    };
    await mkdir(resolve(opts.manifest, '..'), { recursive: true });
    await writeFile(opts.manifest, JSON.stringify(manifest, null, 2) + '\n');
    console.log('Demo/reference records:');
    console.table(
      Object.entries(report.demo.created).map(([entity, created]) => ({
        entity,
        created,
        existing:
          report.demo.existing[entity as keyof typeof report.demo.existing],
      })),
    );
    console.log('Performance records:');
    console.table(
      Object.entries(report.created).map(([entity, created]) => ({
        entity,
        created,
        existing: report.existing[entity as keyof typeof report.existing],
      })),
    );
    console.log(`Manifest: ${resolve(opts.manifest)}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Performance seed failed',
  );
  process.exitCode = 1;
});
