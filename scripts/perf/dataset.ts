import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { convertToBaseCurrency } from '../../src/shared/common/exchange-rate';
import { CommonCurrency } from '../../src/shared/domain/enum';
import { specialties } from '../../prisma/seed/fixtures';

export const PERF_NAMESPACE = 'perf:v1';
export const PERF_EPOCH = new Date('2026-10-01T00:00:00Z');
export type References = {
  companies: number[];
  categories: number[];
  skills: number[];
  arrangements: number[];
};

export function perfId(key: string): string {
  const bytes = createHash('sha1')
    .update(`${PERF_NAMESPACE}:${key}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function applicationSlots(index: number, total: number): number[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= total)
    throw new Error('Application index is outside the requested dataset');
  // Repeating blocks make ownership stable when a smaller dataset is extended.
  const bucket = index % 50;
  if (bucket < 40) return [index % 50];
  if (bucket === 40)
    return Array.from({ length: 10 }, (_, slot) => (index + slot) % 50);
  return [];
}

export function generateJob(index: number, _total: number, refs: References) {
  const bucket = Math.floor(index / 5) % 100;
  const specialty = [45, 65, 75, 82, 88, 93, 96, 98, 99, 100].findIndex(
    (limit) => bucket < limit,
  );
  const currency = index % 2 ? CommonCurrency.USD : CommonCurrency.VND;
  const budget =
    currency === CommonCurrency.USD
      ? 300 + ((index * 37) % 9700)
      : 5_000_000 + ((index * 7919) % 195_000_000);
  // The long tail uses its own specialist skills. Most jobs also use TypeScript.
  const skillIndexes = [specialty * 3, specialty * 3 + 1, specialty * 3 + 2];
  const targetSkills = 3 + (index % 3);
  for (const candidate of [
    4,
    (specialty * 3 + 3) % 30,
    (index * 7) % 30,
    0,
    1,
  ]) {
    if (skillIndexes.length === targetSkills) break;
    if (!skillIndexes.includes(candidate)) skillIndexes.push(candidate);
  }
  const createdAt = new Date(
    PERF_EPOCH.getTime() - ((index * 104729) % (365 * 86400)) * 1000,
  );
  const job: Prisma.JobCreateManyInput & {
    budget: number;
    budgetInBaseCurrency: number;
    currency: 'VND' | 'USD';
  } = {
    publicId: perfId(`job:${index}`),
    title: `${index % 997 === 0 ? 'Perf Quasar Specialist' : `Perf ${specialties[specialty].title}`} #${String(index).padStart(6, '0')}`,
    description: `Synthetic perf:v1 project ${index}. Deliver a tested customer platform with weekly milestones and documented handover.`,
    requirements: `Use ${skillIndexes.map((id) => specialties[Math.floor(id / 3)].skills[id % 3]).join(', ')}. Three years of experience and clear communication.`,
    location: ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Remote'][index % 4],
    status: index % 5 < 4 ? 'OPEN' : 'CLOSED',
    createdAt,
    updatedAt: createdAt,
    dueAt: new Date(
      PERF_EPOCH.getTime() + (((index * 31) % 365) - 30) * 86400_000,
    ),
    budget,
    currency,
    budgetInBaseCurrency: convertToBaseCurrency(budget, currency),
    postedBy: refs.companies[specialty],
    categoryId: refs.categories[specialty],
    arrangementId: refs.arrangements[index % refs.arrangements.length],
  };
  return { job, skillIds: skillIndexes.map((id) => refs.skills[id]) };
}
