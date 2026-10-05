import { createHash } from 'node:crypto';
import { compare, getRounds } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { seedDemo } from '../prisma/seed/seed-demo';
import { fixtureId } from '../prisma/seed/fixtures';
import { hashCanonicalJson } from '../src/shared/common/canonical-json';
import { PrismaService } from '../src/shared/infrastructure/database/prisma.service';
import { JobRepository } from '../src/modules/job/infrastructure/job.repo';
import { ResumeContentRepository } from '../src/modules/resume/infrastructure/resume-content.repo';
import { ApplicantEvaluationRepository } from '../src/modules/applicant-evaluation/infrastructure/applicant-evaluation.repo';
import { ApplicantEvaluationService } from '../src/modules/applicant-evaluation/application/services/applicant-evaluation.service';
import { ResumeRedactEvaluation } from '../src/modules/applicant-evaluation/application/services/resume-redact-evaluation';

// Opt in with an EMPTY, disposable database. This suite never clears existing data.
const databaseUrl = process.env.SEED_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests('demo seed on PostgreSQL', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl! }),
    });
    await prisma.$connect();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.job.count()).toBe(0);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates connected demo data, preserves edits and AI results, and rejects identity conflicts', async () => {
    const password = 'TestDemo@123';
    const first = await seedDemo(prisma, { password });
    expect(first.created).toEqual({
      users: 60,
      companyProfiles: 10,
      applicantProfiles: 50,
      categories: 10,
      skills: 30,
      arrangements: 3,
      jobs: 60,
      jobSkills: 180,
      resumes: 50,
      resumeContents: 50,
      applications: 150,
    });
    expect(await prisma.applicantEvaluation.count()).toBe(0);
    expect(await prisma.refreshToken.count()).toBe(0);

    const users = await prisma.user.findMany({
      include: { companyProfile: true, applicantProfile: true },
    });
    for (const user of users) {
      expect(getRounds(user.passwordHashed)).toBe(10);
      expect(await compare(password, user.passwordHashed)).toBe(true);
      expect(user.role).toBe(`ROLE_${user.userType}`);
      expect(
        user.userType === 'COMPANY'
          ? user.companyProfile
          : user.applicantProfile,
      ).not.toBeNull();
      expect(user.publicId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    const jobs = await prisma.job.findMany({
      include: { jobSkills: { include: { skill: true } } },
    });
    expect(jobs.filter((job) => job.status === 'OPEN')).toHaveLength(50);
    for (const company of users.filter((user) => user.userType === 'COMPANY')) {
      expect(
        jobs.filter(
          (job) => job.postedBy === company.id && job.status === 'OPEN',
        ),
      ).toHaveLength(5);
      expect(
        jobs.filter(
          (job) => job.postedBy === company.id && job.status === 'CLOSED',
        ),
      ).toHaveLength(1);
    }
    for (const job of jobs) {
      if (job.status === 'OPEN')
        expect(job.dueAt.getTime()).toBeGreaterThan(Date.now());
      expect(job.budgetInBaseCurrency.toNumber()).toBe(
        job.budget.toNumber() * (job.currency === 'USD' ? 25_000 : 1),
      );
    }
    const applications = await prisma.jobApplicant.findMany({
      include: {
        resume: true,
        resumeContent: true,
        job: { include: { jobSkills: { include: { skill: true } } } },
      },
    });
    for (const user of users.filter((user) => user.userType === 'APPLICANT')) {
      const owned = applications.filter(
        (application) => application.applicantId === user.id,
      );
      expect(owned).toHaveLength(3);
      const text = owned[0].resumeContent!.extractedText!;
      const overlaps = owned
        .map(
          (application) =>
            application.job.jobSkills.filter(({ skill }) =>
              text.includes(skill.name),
            ).length,
        )
        .sort();
      expect(overlaps).toEqual([0, 1, 3]);
    }
    for (const application of applications) {
      expect(application.status).toBe('PENDING');
      expect(application.job.status).toBe('OPEN');
      expect(application.resume.userId).toBe(application.applicantId);
      const content = application.resumeContent!;
      expect(content.resumeId).toBe(application.resumeId);
      expect(content.status).toBe('COMPLETED');
      expect(content.parserVersion).toBe('seed-text-v1');
      expect(content.contentHash).toBe(
        createHash('sha256').update(content.extractedText!).digest('hex'),
      );
      expect(application.jobSnapshot).toMatchObject({ schemaVersion: 2 });
      expect(application.jobContentHash).toBe(
        hashCanonicalJson(application.jobSnapshot),
      );
      const snapshot = application.jobSnapshot as {
        skills: { id: number }[];
        criteria: { weight: number }[];
      };
      expect(snapshot.skills.map((skill) => skill.id)).toEqual(
        [...snapshot.skills.map((skill) => skill.id)].sort((a, b) => a - b),
      );
      expect(
        snapshot.criteria.reduce((sum, criterion) => sum + criterion.weight, 0),
      ).toBeCloseTo(100);
    }

    const second = await seedDemo(prisma, { password: 'AnotherPassword@123' });
    expect(Object.values(second.created).every((count) => count === 0)).toBe(
      true,
    );
    expect(second.existing).toEqual(first.created);

    // Exercise the API service with real repositories/redaction and only queue/cache fakes.
    const db = prisma as PrismaService;
    const resumeRepository = new ResumeContentRepository(db);
    const queue = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ApplicantEvaluationService(
      resumeRepository,
      new JobRepository(db),
      new ApplicantEvaluationRepository(db),
      queue,
      new ConfigService({ LLM_EVALUATION_MODEL: 'seed-test-model' }),
      {
        get: () => Promise.resolve(undefined),
        set: async () => {},
        delete: async () => {},
      },
      new ResumeRedactEvaluation(resumeRepository),
    );
    const result = await service.evaluateApplicantAsync(
      first.sample.applicantPublicId,
      {
        jobPublicId: first.sample.jobPublicId,
        resumePublicId: first.sample.resumePublicId,
      },
    );
    if (result.isErr()) throw result.error;
    const evaluation = await prisma.applicantEvaluation.findUniqueOrThrow({
      where: { publicId: result.value.publicId },
    });
    expect(evaluation.status).toBe('PENDING');
    expect(evaluation.jobSnapshot).toMatchObject({ schemaVersion: 2 });
    expect(evaluation.redactedResumeText).not.toContain(
      'applicant01@seed.fitwork.test',
    );
    expect(queue.enqueue).toHaveBeenCalledWith({
      evaluationPublicId: evaluation.publicId,
    });
    const input = await new ApplicantEvaluationRepository(
      db,
    ).claimForProcessing(evaluation.publicId);
    if (input.isErr()) throw input.error;
    expect(input.value).not.toBeNull();

    const applicant = users.find(
      (user) => user.publicId === first.sample.applicantPublicId,
    )!;
    await prisma.user.update({
      where: { id: applicant.id },
      data: { fullName: 'Edited Demo Name', isActive: false },
    });
    const job = jobs.find(
      (item) => item.publicId === first.sample.jobPublicId,
    )!;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        title: 'Edited Demo Job',
        status: 'CLOSED',
        requirements: 'Edited requirements',
      },
    });
    await prisma.jobSkill.deleteMany({ where: { jobId: job.id } });
    const application = await prisma.jobApplicant.findFirstOrThrow({
      where: { jobId: job.id, applicantId: applicant.id },
    });
    await prisma.jobApplicant.update({
      where: { id: application.id },
      data: { status: 'ACCEPTED', coverLetter: 'Edited proposal' },
    });
    await prisma.resumeContent.update({
      where: { id: application.resumeContentId! },
      data: { extractedText: 'Edited text', status: 'FAILED' },
    });
    const savedApplication = await prisma.jobApplicant.findUniqueOrThrow({
      where: { id: application.id },
    });
    const savedEvaluation = await prisma.applicantEvaluation.findUniqueOrThrow({
      where: { id: evaluation.id },
    });
    const third = await seedDemo(prisma, { password: 'AnotherPassword@123' });
    expect(Object.values(third.created).every((count) => count === 0)).toBe(
      true,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } }),
    ).toMatchObject({
      fullName: 'Edited Demo Name',
      isActive: false,
      passwordHashed: applicant.passwordHashed,
    });
    expect(
      await prisma.job.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      title: 'Edited Demo Job',
      status: 'CLOSED',
      requirements: 'Edited requirements',
    });
    expect(await prisma.jobSkill.count({ where: { jobId: job.id } })).toBe(0);
    expect(
      await prisma.jobApplicant.findUniqueOrThrow({
        where: { id: application.id },
      }),
    ).toEqual(savedApplication);
    expect(
      await prisma.applicantEvaluation.findUniqueOrThrow({
        where: { id: evaluation.id },
      }),
    ).toEqual(savedEvaluation);
    expect(
      await prisma.resumeContent.findUniqueOrThrow({
        where: { id: application.resumeContentId! },
      }),
    ).toMatchObject({ extractedText: 'Edited text', status: 'FAILED' });
    expect(await prisma.user.count()).toBe(60);
    expect(await prisma.jobApplicant.count()).toBe(150);

    // Repair a missing profile, but never attach a fixture identity to another owner.
    await prisma.applicantProfile.delete({ where: { userId: applicant.id } });
    expect((await seedDemo(prisma)).created.applicantProfiles).toBe(1);
    await prisma.user.update({
      where: { id: applicant.id },
      data: { email: 'identity-conflict@seed.fitwork.test' },
    });
    await expect(seedDemo(prisma)).rejects.toThrow(/identity conflict.*user/i);
    await prisma.user.update({
      where: { id: applicant.id },
      data: { email: applicant.email },
    });
    await prisma.resume.update({
      where: { publicId: first.sample.resumePublicId },
      data: {
        userId: users.find(
          (user) => user.email === 'applicant02@seed.fitwork.test',
        )!.id,
      },
    });
    await expect(seedDemo(prisma)).rejects.toThrow(
      /identity conflict.*resume/i,
    );
    expect(fixtureId('user:applicant:1')).toBe(first.sample.applicantPublicId);
  }, 120_000);
});
