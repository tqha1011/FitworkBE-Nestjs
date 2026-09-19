export type EvaluationBreakdown = {
  schemaVersion: 1;
  skills: number;
  experience: number;
  education: number;
  overallFit: number;
};

export type EvaluationEvidenceV1 = {
  schemaVersion: 1;
  strengths: string[];
  gaps: string[];
  explanation: string;
};
