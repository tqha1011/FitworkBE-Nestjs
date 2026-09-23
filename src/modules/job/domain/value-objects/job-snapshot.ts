export type JobSnapshotV1 = {
  schemaVersion: 1;
  publicId: string;
  title: string;
  description: string;
  requirements: string;
  location: string;
  skills: Array<{ id: number; name: string }>;
  category: { id: number; name: string };
  arrangement: { id: number; name: string };
};

export type JobCriterionCategory =
  'SKILL' | 'EXPERIENCE' | 'EDUCATION' | 'CERTIFICATION' | 'OTHER';

export type JobCriterion = {
  id: string;
  text: string;
  category: JobCriterionCategory;
  weight: number;
  required: boolean;
};

export type JobSnapshotV2 = Omit<JobSnapshotV1, 'schemaVersion'> & {
  schemaVersion: 2;
  criteria: JobCriterion[];
};

export type JobSnapshot = JobSnapshotV1 | JobSnapshotV2;

/** Uses structured job skills as criteria; free-form requirements remain context. */
export function buildJobSnapshotV2(snapshot: JobSnapshotV1): JobSnapshotV2 {
  const skills = [
    ...new Map(snapshot.skills.map((skill) => [skill.id, skill])).values(),
  ];
  const criteria: JobCriterion[] = skills.map((skill) => ({
    id: `skill:${skill.id}`,
    text: `Experience with ${skill.name}`,
    category: 'SKILL',
    weight: 100 / skills.length,
    required: false,
  }));

  return {
    ...snapshot,
    schemaVersion: 2,
    criteria,
  };
}
