import { JobListFilter } from '../../src/modules/job/application/interfaces/job.query-repo.interface';

export type Scenario = {
  name: string;
  pageNumber: number;
  filter: JobListFilter;
};
export function scenarios(categories: number[], skills: number[]): Scenario[] {
  const first = (name: string, filter: JobListFilter = {}): Scenario => ({
    name,
    pageNumber: 1,
    filter,
  });
  return [
    first('first-page'),
    first('title-common', { title: 'Perf Backend Engineer' }),
    first('title-rare', { title: 'Perf Quasar Specialist' }),
    first('title-empty', { title: 'perf:v1:no-results:8f3ac673' }),
    first('category-common', { categoryIds: [categories[0]] }),
    first('category-rare', { categoryIds: [categories[9]] }),
    first('skill-single', { skillIds: [skills[4]] }),
    first('skills-any', { skillIds: [skills[4], skills[27]] }),
    first('budget-range', { budgetMin: 20_000_000, budgetMax: 60_000_000 }),
    first('combined', {
      title: 'Perf Backend Engineer',
      categoryIds: [categories[0]],
      skillIds: [skills[0]],
      budgetMin: 20_000_000,
      budgetMax: 60_000_000,
    }),
    { name: 'page-100', pageNumber: 100, filter: {} },
    { name: 'page-1000', pageNumber: 1000, filter: {} },
  ];
}
export function scenarioQuery(scenario: Scenario, pageSize: number) {
  const query = new URLSearchParams({
    pageNumber: String(scenario.pageNumber),
    pageSize: String(pageSize),
  });
  for (const [key, value] of Object.entries(scenario.filter))
    query.set(key, Array.isArray(value) ? value.join(',') : String(value));
  return query.toString();
}
