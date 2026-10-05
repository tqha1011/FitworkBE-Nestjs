import { createHash } from 'node:crypto';
import { hash } from 'bcrypt';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { buildJobSnapshotV2 } from '../../src/modules/job/domain/value-objects/job-snapshot';
import { hashCanonicalJson } from '../../src/shared/common/canonical-json';
import { convertToBaseCurrency } from '../../src/shared/common/exchange-rate';
import { CommonCurrency } from '../../src/shared/domain/enum';
import {
  applicants,
  arrangementNames,
  companies,
  fixtureId,
  jobs,
  specialties,
} from './fixtures';

export const DEFAULT_SEED_PASSWORD = 'FitworkDemo@123';
const PARSER_VERSION = 'seed-text-v1';
const groups = [
  'users',
  'companyProfiles',
  'applicantProfiles',
  'categories',
  'skills',
  'arrangements',
  'jobs',
  'jobSkills',
  'resumes',
  'resumeContents',
  'applications',
] as const;
type Counts = Record<(typeof groups)[number], number>;
export type SeedReport = {
  created: Counts;
  existing: Counts;
  sample: {
    applicantPublicId: string;
    applicantEmail: string;
    companyEmail: string;
    jobPublicId: string;
    resumePublicId: string;
  };
};

function conflict(kind: string, key: string): never {
  throw new Error(
    `Seed identity conflict for ${kind} (${key}). Resolve the conflicting identifier/owner manually; existing records were not overwritten.`,
  );
}

// A natural key and fixture UUID must resolve to the same row. Mutable fields
// (names, text, statuses, passwords) are intentionally never compared or updated.
function identify<T extends { publicId: string }>(
  kind: string,
  key: string,
  publicId: string,
  byId: T | null,
  byKey: T | null,
): T | null {
  if (
    (byId && byId.publicId !== byKey?.publicId) ||
    (byKey && byKey.publicId !== publicId)
  )
    conflict(kind, key);
  return byId;
}

export async function seedDemo(
  prisma: PrismaClient,
  options: { password?: string; now?: Date } = {},
): Promise<SeedReport> {
  const created = Object.fromEntries(groups.map((key) => [key, 0])) as Counts;
  const existing = { ...created };
  const count = (key: keyof Counts, isNew: boolean, amount = 1) => {
    (isNew ? created : existing)[key] += amount;
  };
  const now = options.now ?? new Date();
  const password = options.password ?? DEFAULT_SEED_PASSWORD;
  if (!password.trim()) throw new Error('SEED_PASSWORD must not be empty');
  let passwordHash: string | undefined;
  const getPasswordHash = async () =>
    passwordHash ?? (passwordHash = await hash(password, 10));
  const transaction = <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => prisma.$transaction(operation, { timeout: 30_000 });

  const references = await transaction(async (tx) => {
    const categoryIds: number[] = [];
    const skillIds = new Map<string, number>();
    const arrangementIds = new Map<string, number>();
    for (const specialty of specialties) {
      const publicId = fixtureId(`category:${specialty.name}`);
      const saved = await tx.category.findUnique({ where: { publicId } });
      const category =
        saved ??
        (await tx.category.create({
          data: { publicId, name: specialty.name },
        }));
      count('categories', !saved);
      categoryIds.push(category.id);
      for (const name of specialty.skills) {
        const skillPublicId = fixtureId(`skill:${name}`);
        const savedSkill = await tx.skill.findUnique({
          where: { publicId: skillPublicId },
        });
        const skill =
          savedSkill ??
          (await tx.skill.create({ data: { publicId: skillPublicId, name } }));
        count('skills', !savedSkill);
        skillIds.set(name, skill.id);
      }
    }
    for (const name of arrangementNames) {
      const matches = await tx.arrangement.findMany({
        where: { name },
        orderBy: { id: 'asc' },
      });
      if (matches.length > 1) conflict('arrangement', name);
      const arrangement =
        matches[0] ?? (await tx.arrangement.create({ data: { name } }));
      count('arrangements', !matches[0]);
      arrangementIds.set(name, arrangement.id);
    }
    return { categoryIds, skillIds, arrangementIds };
  });

  const userIds = new Map<string, number>();
  for (const fixture of [...companies, ...applicants]) {
    const user = await transaction(async (tx) => {
      const isCompany = fixture.key.startsWith('company:');
      const saved = identify(
        'user',
        fixture.email,
        fixture.publicId,
        await tx.user.findUnique({ where: { publicId: fixture.publicId } }),
        await tx.user.findUnique({ where: { email: fixture.email } }),
      );
      const user =
        saved ??
        (await tx.user.create({
          data: {
            publicId: fixture.publicId,
            email: fixture.email,
            username: fixture.username,
            fullName: fixture.fullName,
            passwordHashed: await getPasswordHash(),
            userType: isCompany ? 'COMPANY' : 'APPLICANT',
            role: isCompany ? 'ROLE_COMPANY' : 'ROLE_APPLICANT',
          },
        }));
      count('users', !saved);
      const profileId = fixtureId(`profile:${fixture.key}`);
      if ('companyName' in fixture) {
        const profile = identify(
          'company profile',
          fixture.key,
          profileId,
          await tx.companyProfile.findUnique({
            where: { publicId: profileId },
          }),
          await tx.companyProfile.findUnique({ where: { userId: user.id } }),
        );
        if (!profile)
          await tx.companyProfile.create({
            data: {
              publicId: profileId,
              userId: user.id,
              companyName: fixture.companyName,
              location: fixture.location,
              industry: specialties[fixture.specialty].name,
              website: `https://${fixture.username}.seed.fitwork.test`,
              description:
                'Fictional demo company delivering digital products in Vietnam.',
            },
          });
        count('companyProfiles', !profile);
      } else {
        const profile = identify(
          'applicant profile',
          fixture.key,
          profileId,
          await tx.applicantProfile.findUnique({
            where: { publicId: profileId },
          }),
          await tx.applicantProfile.findUnique({ where: { userId: user.id } }),
        );
        if (!profile)
          await tx.applicantProfile.create({
            data: {
              publicId: profileId,
              userId: user.id,
              location: fixture.location,
              experienceYears: fixture.experienceYears,
              skills: fixture.skills.join(', '),
              description: `Demo ${specialties[fixture.specialty].title}.`,
              portfolioUrl: `https://${fixture.username}.seed.fitwork.test`,
            },
          });
        count('applicantProfiles', !profile);
      }
      return user;
    });
    userIds.set(fixture.key, user.id);
  }

  const jobIds = new Map<string, number>();
  for (const fixture of jobs) {
    const job = await transaction(async (tx) => {
      const postedBy = userIds.get(fixture.companyKey)!;
      const saved = await tx.job.findUnique({
        where: { publicId: fixture.publicId },
      });
      if (saved && saved.postedBy !== postedBy)
        conflict('job owner', fixture.key);
      const job =
        saved ??
        (await tx.job.create({
          data: {
            publicId: fixture.publicId,
            title: fixture.title,
            description: fixture.description,
            requirements: fixture.requirements,
            location: fixture.location,
            status: fixture.status,
            dueAt: new Date(
              now.getTime() +
                (fixture.status === 'OPEN' ? 90 : -30) * 86_400_000,
            ),
            budget: fixture.budget,
            currency: fixture.currency,
            budgetInBaseCurrency: convertToBaseCurrency(
              fixture.budget,
              CommonCurrency[fixture.currency],
            ),
            postedBy,
            categoryId: references.categoryIds[fixture.specialty],
            arrangementId: references.arrangementIds.get(fixture.arrangement)!,
            jobSkills: {
              create: fixture.skills.map((name) => ({
                skillId: references.skillIds.get(name)!,
              })),
            },
          },
        }));
      count('jobs', !saved);
      // Existing jobs retain their current relations, including deliberately removed skills.
      count(
        'jobSkills',
        !saved,
        saved
          ? await tx.jobSkill.count({ where: { jobId: job.id } })
          : fixture.skills.length,
      );
      return job;
    });
    jobIds.set(fixture.key, job.id);
  }

  for (const fixture of applicants) {
    await transaction(async (tx) => {
      const userId = userIds.get(fixture.key)!;
      const savedResume = await tx.resume.findUnique({
        where: { publicId: fixture.resumePublicId },
      });
      if (savedResume && savedResume.userId !== userId)
        conflict('resume owner', fixture.key);
      const file = {
        storagePath: fixture.storagePath,
        fileName: `${fixture.username}-demo.pdf`,
        fileType: 'PDF' as const,
        // Simulated metadata: this measures fixture text, not an uploaded PDF.
        fileSize: Buffer.byteLength(fixture.text, 'utf8'),
      };
      const resume =
        savedResume ??
        (await tx.resume.create({
          data: { ...file, publicId: fixture.resumePublicId, userId },
        }));
      count('resumes', !savedResume);
      const savedContent = identify(
        'resume content',
        fixture.key,
        fixture.contentPublicId,
        await tx.resumeContent.findUnique({
          where: { publicId: fixture.contentPublicId },
        }),
        await tx.resumeContent.findUnique({
          where: {
            resumeId_storagePath_parserVersion: {
              resumeId: resume.id,
              storagePath: fixture.storagePath,
              parserVersion: PARSER_VERSION,
            },
          },
        }),
      );
      const content =
        savedContent ??
        (await tx.resumeContent.create({
          data: {
            ...file,
            publicId: fixture.contentPublicId,
            resumeId: resume.id,
            status: 'COMPLETED',
            extractedText: fixture.text,
            contentHash: createHash('sha256')
              .update(fixture.text, 'utf8')
              .digest('hex'),
            parserVersion: PARSER_VERSION,
            startedAt: now,
            completedAt: now,
            structuredData: {
              simulated: true,
              downloadable: false,
              source: 'demo-seed',
              note: 'Synthetic parsed text; no storage object exists.',
            },
          },
        }));
      count('resumeContents', !savedContent);

      for (const jobKey of fixture.jobKeys) {
        const jobId = jobIds.get(jobKey)!;
        const publicId = fixtureId(`application:${fixture.key}:${jobKey}`);
        const saved = identify(
          'application',
          `${fixture.key}:${jobKey}`,
          publicId,
          await tx.jobApplicant.findUnique({ where: { publicId } }),
          await tx.jobApplicant.findUnique({
            where: { jobId_applicantId: { jobId, applicantId: userId } },
          }),
        );
        if (!saved) {
          // Capture actual persisted data, including edits, rather than fixture text.
          const job = await tx.job.findUniqueOrThrow({
            where: { id: jobId },
            include: {
              category: true,
              arrangement: true,
              jobSkills: {
                include: { skill: true },
                orderBy: { skillId: 'asc' },
              },
            },
          });
          const snapshot = buildJobSnapshotV2({
            schemaVersion: 1,
            publicId: job.publicId,
            title: job.title,
            description: job.description,
            requirements: job.requirements,
            location: job.location,
            skills: job.jobSkills.map(({ skill }) => ({
              id: skill.id,
              name: skill.name,
            })),
            category: { id: job.category.id, name: job.category.name },
            arrangement: { id: job.arrangement.id, name: job.arrangement.name },
          });
          await tx.jobApplicant.create({
            data: {
              publicId,
              jobId,
              applicantId: userId,
              resumeId: resume.id,
              resumeContentId: content.id,
              jobSnapshot: snapshot,
              jobContentHash: hashCanonicalJson(snapshot),
              coverLetter: `I would like to contribute to this project. My experience in ${specialties[fixture.specialty].name} and reliable delivery will support your team. Please see my demo resume for details.`,
              proposedRate: job.budget,
              estimatedDay: 30,
              status: 'PENDING',
            },
          });
        }
        count('applications', !saved);
      }
    });
  }

  const sample = applicants[0];
  return {
    created,
    existing,
    sample: {
      applicantPublicId: sample.publicId,
      applicantEmail: sample.email,
      companyEmail: companies[0].email,
      jobPublicId: fixtureId(sample.jobKeys[0]),
      resumePublicId: sample.resumePublicId,
    },
  };
}
