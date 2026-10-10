import 'dotenv/config';
import { Pool } from 'pg';
import { seedPerf } from '../scripts/perf/seed';
import { createPrisma } from '../scripts/perf/database';
import { perfId } from '../scripts/perf/dataset';
import { findPerfSentinel } from '../scripts/perf/sentinel';
import { PrismaService } from '../src/shared/infrastructure/database/prisma.service';
import { JobRepository } from '../src/modules/job/infrastructure/job.repo';
import { captureAndExplain } from '../scripts/perf/explain';

// Opt in only with a separately migrated, EMPTY disposable database.
const databaseUrl = process.env.PERF_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;
databaseTests('performance seed and real search on PostgreSQL', () => {
  let prisma: ReturnType<typeof createPrisma>;
  let pool: Pool;
  let refs: Awaited<ReturnType<typeof seedPerf>>['references'];
  let repo: JobRepository;
  beforeAll(async () => {
    const db = new URL(databaseUrl!);
    if (
      !/test/i.test(db.pathname) ||
      (process.env.DATABASE_URL &&
        db.pathname === new URL(process.env.DATABASE_URL).pathname)
    )
      throw new Error(
        'PERF_TEST_DATABASE_URL must use a distinct database named *test*, never the development database',
      );
    prisma = createPrisma(databaseUrl!, true);
    pool = new Pool({ connectionString: databaseUrl! });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
    repo = new JobRepository(prisma as PrismaService);
  });
  afterAll(async () => {
    // No data clearing: keep failures inspectable. Use a fresh disposable DB each run.
    if (pool) {
      await pool.query('DROP TRIGGER IF EXISTS perf_test_batch_failure ON job');
      await pool.query('DROP FUNCTION IF EXISTS perf_test_batch_failure()');
      await pool.end();
    }
    await prisma?.$disconnect();
  });

  it('rolls back a failed batch and resumes without duplicating completed batches', async () => {
    await pool.query(`CREATE FUNCTION perf_test_batch_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.public_id = '${perfId('job:35')}' THEN RAISE EXCEPTION 'injected batch failure'; END IF; RETURN NEW; END $$`);
    await pool.query(
      'CREATE TRIGGER perf_test_batch_failure BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION perf_test_batch_failure()',
    );
    await expect(
      seedPerf(prisma, { jobs: 100, batchSize: 20 }),
    ).rejects.toThrow();
    expect(await prisma.job.count()).toBe(80); // 60 demo + first 20 committed perf jobs.
    expect(
      await prisma.job.findUnique({ where: { publicId: perfId('job:20') } }),
    ).toBeNull();
    await pool.query('DROP TRIGGER perf_test_batch_failure ON job');
    const resumed = await seedPerf(prisma, { jobs: 100, batchSize: 20 });
    expect(resumed.created.jobs).toBe(80);
    expect(resumed.existing.jobs).toBe(20);
    expect(await prisma.job.count()).toBe(160);
    expect(await prisma.jobApplicant.count()).toBe(250); // 150 demo + 100 perf.
    refs = resumed.references;
    const badOwnership = await pool.query(`SELECT a.id FROM job_applicant a
      JOIN resume r ON r.id = a.resume_id
      JOIN resume_content c ON c.id = a.resume_content_id
      WHERE r.user_id <> a.applicant_id OR c.resume_id <> r.id`);
    expect(badOwnership.rowCount).toBe(0);
  }, 120_000);

  it('searches OPEN jobs with filters, OR skill matching, converted budgets and deep pages', async () => {
    const search = async (
      page: number,
      size: number,
      filter: Parameters<JobRepository['getListJobs']>[2],
    ) => {
      const result = await repo.getListJobs(page, size, filter);
      if (result.isErr()) throw result.error;
      return result.value;
    };
    const all = await search(1, 100, { title: 'Perf ' });
    expect(all.items).toHaveLength(80);
    expect(all.items.some((x) => x.publicId === perfId('job:4'))).toBe(false);
    expect(all.totalPages).toBe(1);
    const rare = await search(1, 20, { title: 'Perf Quasar Specialist' });
    expect(rare.items.map((x) => x.publicId)).toEqual([perfId('job:0')]);
    expect(
      (await search(1, 20, { title: 'perf:v1:no-results' })).items,
    ).toEqual([]);
    const category = await search(1, 100, {
      title: 'Perf ',
      categoryIds: [refs.refs.categories[0]],
    });
    expect(category.items).toHaveLength(80);
    expect(
      (
        await search(1, 100, {
          title: 'Perf ',
          categoryIds: [refs.refs.categories[9]],
        })
      ).items,
    ).toHaveLength(0);
    const single = await search(1, 100, {
      title: 'Perf ',
      skillIds: [refs.refs.skills[4]],
    });
    const any = await search(1, 100, {
      title: 'Perf ',
      skillIds: [refs.refs.skills[4], refs.refs.skills[27]],
    });
    // All 100 jobs are backend; none has specialist skill 27. OR must retain matches for skill 4.
    expect(single.items.length).toBeGreaterThan(0);
    expect(any.items.map((x) => x.publicId)).toEqual(
      single.items.map((x) => x.publicId),
    );
    const budget = await search(1, 100, {
      title: 'Perf ',
      budgetMin: 5_000_000,
      budgetMax: 5_100_000,
    });
    expect(budget.items.map((x) => x.publicId)).toEqual(
      [0, 2, 6, 8, 10, 12].map((i) => perfId(`job:${i}`)),
    );
    const usd = await search(1, 20, {
      title: '#000001',
      budgetMin: 8_425_000,
      budgetMax: 8_425_000,
    });
    expect(usd.items.map((x) => x.publicId)).toEqual([perfId('job:1')]);
    const combined = await search(1, 20, {
      title: '#000001',
      categoryIds: [refs.refs.categories[0]],
      skillIds: [refs.refs.skills[4]],
      budgetMin: 8_425_000,
      budgetMax: 8_425_000,
    });
    expect(combined.items.map((x) => x.publicId)).toEqual([perfId('job:1')]);
    const second = await search(2, 7, { title: 'Perf ' });
    expect(second.items.map((x) => x.publicId)).toEqual(
      [8, 10, 11, 12, 13, 15, 16].map((i) => perfId(`job:${i}`)),
    );
    expect(second.totalPages).toBe(12);
    expect(second.hasPrevious).toBe(true);
    expect((await search(1000, 20, { title: 'Perf ' })).items).toEqual([]);
    // Jobs 40 and 90 each have ten applications. Status cycling yields 6 and 4 active.
    expect(
      all.items.find((x) => x.publicId === perfId('job:40'))!.totalApplicants,
    ).toBe(6);
    expect(
      all.items.find((x) => x.publicId === perfId('job:90'))!.totalApplicants,
    ).toBe(4);
    expect(
      all.items.find((x) => x.publicId === perfId('job:2'))!.totalApplicants,
    ).toBe(0);
  });

  it('captures list, count and real relation SQL with runnable EXPLAIN plans', async () => {
    const plans = await captureAndExplain(
      prisma,
      pool,
      [
        {
          name: 'integration-first',
          pageNumber: 1,
          filter: { title: 'Perf ' },
        },
      ],
      20,
    );
    expect(plans[0].queries.length).toBeGreaterThanOrEqual(2);
    expect(plans[0].queries.some((x) => /COUNT\(\*\)/i.test(x.sql))).toBe(true);
    expect(plans[0].queries.some((x) => /job_skill/.test(x.sql))).toBe(true);
    expect(
      plans[0].queries.every(
        (x) => x.nodes.length && x.plan['Execution Time'] >= 0,
      ),
    ).toBe(true);
  });

  it('selects an OPEN manifest sentinel from 50,000 IDs without exceeding PostgreSQL parameters', async () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => perfId(`job:${i}`));
    const sentinel = await findPerfSentinel(prisma, ids);
    expect(ids).toContain(sentinel.publicId);
    expect(sentinel.title).toMatch(/^Perf /);
  });

  it('is idempotent and preserves edited jobs, skills and application statuses', async () => {
    const job = await prisma.job.findUniqueOrThrow({
      where: { publicId: perfId('job:0') },
    });
    await prisma.job.update({
      where: { id: job.id },
      data: { title: 'Perf Edited', status: 'CLOSED' },
    });
    await prisma.jobSkill.deleteMany({ where: { jobId: job.id } });
    const appId = perfId('application:0:0');
    await prisma.jobApplicant.update({
      where: { publicId: appId },
      data: { status: 'COMPLETED', coverLetter: 'Human edit' },
    });
    const rerun = await seedPerf(prisma, { jobs: 100, batchSize: 20 });
    expect(rerun.created).toEqual({ jobs: 0, jobSkills: 0, applications: 0 });
    expect(await prisma.job.count()).toBe(160);
    expect(await prisma.jobApplicant.count()).toBe(250);
    expect(
      await prisma.job.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ title: 'Perf Edited', status: 'CLOSED' });
    expect(await prisma.jobSkill.count({ where: { jobId: job.id } })).toBe(0);
    expect(
      await prisma.jobApplicant.findUnique({ where: { publicId: appId } }),
    ).toMatchObject({ status: 'COMPLETED', coverLetter: 'Human edit' });
  }, 120_000);
});
