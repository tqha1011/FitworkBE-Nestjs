import 'dotenv/config';
import { Pool } from 'pg';
import { inspectDatabase, requiredEnv } from './database';

async function main() {
  const pool = new Pool({ connectionString: requiredEnv('PERF_DATABASE_URL') });
  try {
    console.log(JSON.stringify(await inspectDatabase(pool), null, 2));
  } finally {
    await pool.end();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Database inspection failed',
  );
  process.exitCode = 1;
});
