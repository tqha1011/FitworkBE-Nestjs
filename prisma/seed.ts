import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { seedDemo } from './seed/seed-demo';

async function main() {
  const connectionString =
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error(
      'Seed requires DIRECT_URL or DATABASE_URL in the environment or .env',
    );
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const report = await seedDemo(prisma, {
      password: process.env.SEED_PASSWORD,
    });
    console.table(
      Object.entries(report.created).map(([entity, created]) => ({
        entity,
        created,
        existing: report.existing[entity as keyof typeof report.existing],
      })),
    );
    console.log('Sample evaluation (log in as this applicant):', report.sample);
    console.log(
      'Demo resumes contain synthetic parsed text in the database; no files exist in storage.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo seed failed');
  process.exitCode = 1;
});
