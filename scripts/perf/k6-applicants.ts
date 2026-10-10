import { compare, hash as hashPassword } from 'bcrypt';
import type { PrismaClient } from '../../generated/prisma/client';
import { perfId } from './dataset';
import { hash } from './k6-support';
import { sessionFromLogin } from './k6/workload';

export type ApplicantRow = {
  id: number;
  publicId: string;
  email: string;
  passwordHashed: string;
  isActive: boolean;
  role: string;
  userType: string;
  applicantProfile: { id: number } | null;
};
export type NewApplicant = {
  publicId: string;
  email: string;
  username: string;
  fullName: string;
  passwordHashed: string;
  userType: 'APPLICANT';
  role: 'ROLE_APPLICANT';
};
export type ApplicantStore = {
  list: () => Promise<ApplicantRow[]>;
  create: (accounts: NewApplicant[]) => Promise<ApplicantRow[]>;
};
const select = {
  id: true,
  publicId: true,
  email: true,
  passwordHashed: true,
  isActive: true,
  role: true,
  userType: true,
  applicantProfile: { select: { id: true } },
} as const;
export function applicantStore(prisma: PrismaClient): ApplicantStore {
  return {
    list: () =>
      prisma.user.findMany({
        where: {
          OR: [
            { email: { endsWith: '@seed.fitwork.test' } },
            { email: { endsWith: '@perf.fitwork.test' } },
          ],
        },
        select,
        orderBy: { email: 'asc' },
      }),
    create: (accounts) =>
      prisma.$transaction(
        async (tx) => {
          // One transaction for users and profiles, never overwrite or reset passwords.
          await tx.user.createMany({ data: accounts });
          const created = await tx.user.findMany({
            where: { publicId: { in: accounts.map((a) => a.publicId) } },
            select: { id: true, publicId: true },
          });
          await tx.applicantProfile.createMany({
            data: created.map((user) => ({
              userId: user.id,
              publicId: perfId(`k6:profile:${user.publicId}`),
              skills: 'Node.js, TypeScript, PostgreSQL',
              experienceYears: 3,
              location: 'Remote',
              description: 'Synthetic applicant for k6 login/search workload.',
            })),
          });
          return tx.user.findMany({
            where: { publicId: { in: accounts.map((a) => a.publicId) } },
            select,
            orderBy: { email: 'asc' },
          });
        },
        { timeout: 30000 },
      ),
  };
}

export async function prepareApplicants(
  store: ApplicantStore,
  target: number,
  password: string,
  seedMissing: boolean,
) {
  if (!Number.isSafeInteger(target) || target < 1 || target > 500)
    throw new Error('Applicant account count must be between 1 and 500');
  if (!password)
    throw new Error('K6_APPLICANT_PASSWORD/SEED_PASSWORD must not be empty');
  const rows = (await store.list())
    .slice()
    .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  const eligible: ApplicantRow[] = [];
  const verified = new Map<string, boolean>();
  for (const row of rows) {
    if (
      !row.isActive ||
      row.userType !== 'APPLICANT' ||
      row.role !== 'ROLE_APPLICANT' ||
      !row.applicantProfile ||
      !/@(?:seed|perf)\.fitwork\.test$/.test(row.email)
    )
      continue;
    let matches = verified.get(row.passwordHashed);
    if (matches === undefined) {
      try {
        matches = await compare(password, row.passwordHashed);
      } catch {
        matches = false;
      }
      verified.set(row.passwordHashed, matches);
    }
    if (matches) eligible.push(row);
    if (eligible.length === target) break;
  }
  const reused = eligible.length;
  const needed = target - reused;
  if (needed && !seedMissing)
    throw new Error(
      `Not enough active seed applicants with the configured password (${reused}/${target}); allow seeding or provide the matching password`,
    );
  if (needed) {
    const hashed = await hashPassword(password, 10);
    const occupiedEmails = new Set(rows.map((a) => a.email));
    const occupiedIds = new Set(rows.map((a) => a.publicId));
    const additions: NewApplicant[] = [];
    for (let slot = 1; additions.length < needed && slot <= 10000; slot++) {
      const number = String(slot).padStart(4, '0');
      const email = `k6-applicant-${number}@perf.fitwork.test`;
      const publicId = perfId(`k6:applicant:${slot}`);
      if (occupiedEmails.has(email) || occupiedIds.has(publicId)) continue;
      additions.push({
        email,
        publicId,
        username: `k6_applicant_${number}`,
        fullName: `K6 Applicant ${number}`,
        passwordHashed: hashed,
        userType: 'APPLICANT',
        role: 'ROLE_APPLICANT',
      });
    }
    if (additions.length !== needed)
      throw new Error(
        'Reserved applicant identity space exhausted; no existing account was changed',
      );
    eligible.push(...(await store.create(additions)));
  }
  eligible.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  if (
    eligible.length !== target ||
    new Set(eligible.map((a) => a.email)).size !== target ||
    new Set(eligible.map((a) => a.publicId)).size !== target
  )
    throw new Error(
      'Applicant account identities are incomplete or duplicated',
    );
  return {
    accounts: eligible.map(({ email, publicId }) => ({ email, publicId })),
    reused,
    created: needed,
    identitiesHash: hash(
      eligible.map(({ publicId, email, passwordHashed }) => ({
        publicId,
        email,
        passwordHashed,
      })),
    ),
  };
}

export async function loginApplicant(
  apiBaseUrl: string,
  account: { email: string; publicId: string },
  password: string,
) {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: account.email, password }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (response.status !== 200)
    throw new Error(
      `Applicant preflight login HTTP ${response.status}; check seed password and API`,
    );
  const payload: unknown = await response.json();
  const session = sessionFromLogin(
    payload,
    account.publicId,
    Date.now(),
    (value) => Buffer.from(value, 'base64url').toString(),
  );
  if (!session)
    throw new Error(
      'Applicant preflight login returned an invalid identity/token payload',
    );
  return session.token;
}
