import { buildJobSnapshotV2, JobSnapshotV1 } from './job-snapshot';

describe('buildJobSnapshotV2', () => {
  const snapshot: JobSnapshotV1 = {
    schemaVersion: 1,
    publicId: 'job-id',
    title: 'Backend Engineer',
    description: 'Build services',
    requirements: 'Three years of backend experience',
    location: 'Remote',
    skills: [
      { id: 1, name: 'TypeScript' },
      { id: 2, name: 'NestJS' },
    ],
    category: { id: 2, name: 'Engineering' },
    arrangement: { id: 3, name: 'Remote' },
  };

  it('creates deterministic skill criteria and preserves free-form requirements', () => {
    const result = buildJobSnapshotV2(snapshot);

    expect(result.schemaVersion).toBe(2);
    expect(result.requirements).toBe(snapshot.requirements);
    expect(result.criteria).toEqual([
      {
        id: 'skill:1',
        text: 'Experience with TypeScript',
        category: 'SKILL',
        weight: 50,
        required: false,
      },
      {
        id: 'skill:2',
        text: 'Experience with NestJS',
        category: 'SKILL',
        weight: 50,
        required: false,
      },
    ]);
  });

  it('does not split a prose requirement into fake criteria', () => {
    const requirements = '3 years of NestJS, PostgreSQL and AWS experience';
    const result = buildJobSnapshotV2({ ...snapshot, requirements });

    expect(result.requirements).toBe(requirements);
    expect(result.criteria.map((criterion) => criterion.id)).toEqual([
      'skill:1',
      'skill:2',
    ]);
  });

  it('deduplicates repeated skill IDs', () => {
    const result = buildJobSnapshotV2({
      ...snapshot,
      skills: [...snapshot.skills, snapshot.skills[0]],
    });

    expect(result.criteria.map((criterion) => criterion.id)).toEqual([
      'skill:1',
      'skill:2',
    ]);
  });
});
