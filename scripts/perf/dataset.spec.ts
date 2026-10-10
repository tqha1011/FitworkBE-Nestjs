import { applicationSlots, generateJob, perfId } from './dataset';
import { fixtureId } from '../../prisma/seed/fixtures';

const references = {
  companies: Array.from({ length: 10 }, (_, i) => i + 1),
  categories: Array.from({ length: 10 }, (_, i) => i + 1),
  skills: Array.from({ length: 30 }, (_, i) => i + 1),
  arrangements: [1, 2, 3],
};

describe('performance dataset', () => {
  it('rejects an application index outside the requested dataset', () => {
    expect(() => applicationSlots(100, 100)).toThrow();
    expect(() => applicationSlots(-1, 100)).toThrow();
  });
  it('keeps application ownership stable when extending the dataset', () => {
    expect(applicationSlots(80, 100)).toEqual(applicationSlots(80, 50000));
    expect(applicationSlots(90, 100)).toEqual(applicationSlots(90, 50000));
  });
  it('has stable UUIDs in a separate namespace', () => {
    expect(perfId('job:0')).toBe(perfId('job:0'));
    expect(perfId('job:0')).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
    expect(perfId('job:0')).not.toBe(fixtureId('job:0'));
    expect(perfId('job:0')).not.toBe(perfId('job:1'));
  });

  it('generates exactly 40k open jobs, 3–5 distinct skills and converted budgets', () => {
    const statuses: Record<string, number> = {};
    const categories: Record<string, number> = {};
    const titles = new Set<string>();
    const currencies = new Set<string>();
    for (let i = 0; i < 50_000; i++) {
      const { job, skillIds } = generateJob(i, 50_000, references);
      statuses[job.status] = (statuses[job.status] ?? 0) + 1;
      categories[job.categoryId] = (categories[job.categoryId] ?? 0) + 1;
      expect(skillIds.length).toBeGreaterThanOrEqual(3);
      expect(skillIds.length).toBeLessThanOrEqual(5);
      expect(new Set(skillIds).size).toBe(skillIds.length);
      expect(job.budgetInBaseCurrency).toBe(
        job.budget * (job.currency === 'USD' ? 25_000 : 1),
      );
      titles.add(job.title);
      currencies.add(job.currency);
    }
    expect(statuses).toEqual({ OPEN: 40_000, CLOSED: 10_000 });
    expect(categories[1]).toBeGreaterThan(categories[10] * 10);
    expect(titles.size).toBe(50_000);
    expect([...currencies].sort()).toEqual(['USD', 'VND']);
  });

  it('assigns 40k single, 1k ten and 9k zero applications without duplicate owners', () => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (let i = 0; i < 50_000; i++) {
      const slots = applicationSlots(i, 50_000);
      counts[slots.length] = (counts[slots.length] ?? 0) + 1;
      total += slots.length;
      expect(new Set(slots).size).toBe(slots.length);
      expect(slots.every((slot) => slot >= 0 && slot < 50)).toBe(true);
    }
    expect(counts).toEqual({ 0: 9_000, 1: 40_000, 10: 1_000 });
    expect(total).toBe(50_000);
  });
});
