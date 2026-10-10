import { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  applicants,
  arrangementNames,
  companies,
  fixtureId,
  specialties,
} from '../../prisma/seed/fixtures';
import { seedDemo } from '../../prisma/seed/seed-demo';
import { applicationSlots, generateJob, perfId, References } from './dataset';

export async function loadReferences(prisma: PrismaClient) {
  const [users, categories, skills, arrangements, resumes, contents] =
    await Promise.all([
      prisma.user.findMany({
        where: {
          publicId: {
            in: [...companies, ...applicants].map((x) => x.publicId),
          },
        },
      }),
      prisma.category.findMany({
        where: {
          publicId: {
            in: specialties.map((x) => fixtureId(`category:${x.name}`)),
          },
        },
      }),
      prisma.skill.findMany({
        where: {
          publicId: {
            in: specialties.flatMap((x) =>
              x.skills.map((name) => fixtureId(`skill:${name}`)),
            ),
          },
        },
      }),
      prisma.arrangement.findMany({
        where: { name: { in: [...arrangementNames] } },
      }),
      prisma.resume.findMany({
        where: { publicId: { in: applicants.map((x) => x.resumePublicId) } },
      }),
      prisma.resumeContent.findMany({
        where: { publicId: { in: applicants.map((x) => x.contentPublicId) } },
      }),
    ]);
  function get<T extends { publicId: string }>(rows: T[], id: string): T {
    const row = rows.find((x) => x.publicId === id);
    if (!row) throw new Error(`Missing reference ${id}`);
    return row;
  }
  const owners = applicants.map((fixture) => {
    const user = get(users, fixture.publicId);
    const resume = get(resumes, fixture.resumePublicId);
    const content = get(contents, fixture.contentPublicId);
    if (resume.userId !== user.id || content.resumeId !== resume.id)
      throw new Error('Performance seed reference ownership conflict');
    return {
      applicantId: user.id,
      resumeId: resume.id,
      resumeContentId: content.id,
    };
  });
  const refs: References = {
    companies: companies.map((x) => get(users, x.publicId).id),
    categories: specialties.map(
      (x) => get(categories, fixtureId(`category:${x.name}`)).id,
    ),
    skills: specialties.flatMap((x) =>
      x.skills.map((name) => get(skills, fixtureId(`skill:${name}`)).id),
    ),
    arrangements: arrangementNames.map((name) => {
      const matches = arrangements.filter((x) => x.name === name);
      if (matches.length !== 1)
        throw new Error(`Ambiguous arrangement ${name}`);
      return matches[0].id;
    }),
  };
  return { refs, owners, categories, skills, arrangements };
}

export async function seedPerf(
  prisma: PrismaClient,
  options: { jobs: number; batchSize?: number; password?: string },
) {
  const batchSize = options.batchSize ?? 1000;
  if (
    !Number.isSafeInteger(options.jobs) ||
    options.jobs < 1 ||
    options.jobs > 1_000_000
  )
    throw new Error('jobs must be an integer between 1 and 1000000');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error('batchSize must be an integer between 1 and 1000');
  const demo = await seedDemo(prisma, { password: options.password });
  const references = await loadReferences(prisma);
  const created = { jobs: 0, jobSkills: 0, applications: 0 };
  const existing = { ...created };
  for (let start = 0; start < options.jobs; start += batchSize) {
    const fixtures = Array.from(
      { length: Math.min(batchSize, options.jobs - start) },
      (_, offset) => ({
        index: start + offset,
        ...generateJob(start + offset, options.jobs, references.refs),
      }),
    );
    // Only publish counters after the entire batch commits.
    const counts = await prisma.$transaction(
      async (tx) => {
        const prior = await tx.job.findMany({
          where: { publicId: { in: fixtures.map((x) => x.job.publicId!) } },
        });
        const byPublicId = new Map(prior.map((x) => [x.publicId, x]));
        for (const { job } of fixtures) {
          const saved = byPublicId.get(job.publicId!);
          if (saved && saved.postedBy !== job.postedBy)
            throw new Error(`Performance job owner conflict: ${job.publicId}`);
        }
        const missing = fixtures.filter(
          (x) => !byPublicId.has(x.job.publicId!),
        );
        const newJobs = await tx.job.createMany({
          data: missing.map((x) => x.job),
          skipDuplicates: true,
        });
        const saved = await tx.job.findMany({
          where: { publicId: { in: fixtures.map((x) => x.job.publicId!) } },
        });
        const jobsById = new Map(saved.map((x) => [x.publicId, x]));
        const newSkills = await tx.jobSkill.createMany({
          data: missing.flatMap((x) =>
            x.skillIds.map((skillId) => ({
              jobId: jobsById.get(x.job.publicId!)!.id,
              skillId,
            })),
          ),
          skipDuplicates: true,
        });
        const savedSkills = await tx.jobSkill.count({
          where: { jobId: { in: prior.map((x) => x.id) } },
        });
        const priorApps = await tx.jobApplicant.findMany({
          where: { jobId: { in: saved.map((x) => x.id) } },
        });
        const byPair = new Map(
          priorApps.map((x) => [`${x.jobId}:${x.applicantId}`, x]),
        );
        const applications: Prisma.JobApplicantCreateManyInput[] = [];
        let savedApps = 0;
        for (const fixture of fixtures) {
          const job = jobsById.get(fixture.job.publicId!)!;
          for (const [applicationIndex, slot] of applicationSlots(
            fixture.index,
            options.jobs,
          ).entries()) {
            const owner = references.owners[slot];
            const publicId = perfId(`application:${fixture.index}:${slot}`);
            const priorApp = byPair.get(`${job.id}:${owner.applicantId}`);
            if (priorApp) {
              if (
                priorApp.publicId !== publicId ||
                priorApp.resumeId !== owner.resumeId ||
                priorApp.resumeContentId !== owner.resumeContentId
              )
                throw new Error(
                  `Performance application ownership/identity conflict: ${publicId}`,
                );
              savedApps++;
              continue;
            }
            applications.push({
              publicId,
              jobId: job.id,
              ...owner,
              coverLetter:
                'Synthetic perf:v1 application for search count benchmarking.',
              proposedRate: job.budget,
              estimatedDay: 7 + ((fixture.index + slot) % 84),
              status: (
                ['PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED'] as const
              )[(fixture.index + applicationIndex) % 4],
              appliedAt: job.createdAt,
            });
          }
        }
        // Different public ID on the same natural key is an error, never silently skipped.
        const newApps = await tx.jobApplicant.createMany({
          data: applications,
        });
        return {
          created: {
            jobs: newJobs.count,
            jobSkills: newSkills.count,
            applications: newApps.count,
          },
          existing: {
            jobs: prior.length,
            jobSkills: savedSkills,
            applications: savedApps,
          },
        };
      },
      { timeout: 60_000 },
    );
    for (const key of Object.keys(created) as (keyof typeof created)[]) {
      created[key] += counts.created[key];
      existing[key] += counts.existing[key];
    }
    console.log(
      `Committed ${Math.min(start + batchSize, options.jobs)}/${options.jobs} jobs`,
    );
  }
  return { created, existing, demo, references };
}
