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
