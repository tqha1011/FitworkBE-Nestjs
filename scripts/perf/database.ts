import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (no DATABASE_URL fallback)`);
  return value;
}

export function createPrisma(connectionString: string, capture = false) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: capture ? [{ emit: 'event', level: 'query' }] : [],
  });
}

export async function inspectDatabase(pool: Pool) {
  const identity = await pool.query<Record<string, unknown>>(`
    SELECT current_database() AS database, current_schema() AS schema,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
      (SELECT oid::text FROM pg_namespace WHERE nspname = current_schema()) AS schema_oid,
      inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
      version() AS version`);
  // System identifier separates different clusters with identically named databases.
  let systemIdentifier: string | null = null;
  try {
    const result = await pool.query<{ system_identifier: string }>(
      'SELECT system_identifier::text FROM pg_control_system()',
    );
    systemIdentifier = result.rows[0].system_identifier;
  } catch {
    // A restricted role may not be permitted to call pg_control_system.
  }
  const row = { ...identity.rows[0], system_identifier: systemIdentifier };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(row))
    .digest('hex');
  const indexes = await pool.query<Record<string, unknown>>(`
    SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('job', 'job_skill', 'job_applicant')
    ORDER BY tablename, indexname`);
  const counts = await pool.query<Record<string, unknown>>(`SELECT
    (SELECT count(*)::int FROM job) AS jobs,
    (SELECT count(*)::int FROM job WHERE status = 'OPEN') AS open_jobs,
    (SELECT count(*)::int FROM job_skill) AS job_skills,
    (SELECT count(*)::int FROM job_applicant) AS applications`);
  return {
    identity: row,
    fingerprint,
    indexes: indexes.rows,
    counts: counts.rows[0],
  };
}

export async function analyze(pool: Pool) {
  for (const table of ['job', 'job_skill', 'job_applicant'])
    await pool.query(`ANALYZE "${table}"`);
}
