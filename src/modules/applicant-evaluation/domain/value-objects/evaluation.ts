import { JobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';

export type EvaluationBreakdownV1 = {
  schemaVersion: 1;
  skills: number;
  experience: number;
  education: number;
  overallFit: number;
};

export type EvaluationBreakdownV2 = {
  schemaVersion: 2;
  criteria: Array<{ criterionId: string; scoreContribution: number }>;
};

export type EvaluationBreakdown = EvaluationBreakdownV1 | EvaluationBreakdownV2;

export type EvaluationEvidenceV1 = {
  schemaVersion: 1;
  strengths: string[];
  gaps: string[];
  explanation: string;
};

export type EvaluationEvidenceV2 = {
  schemaVersion: 2;
  criteria: EvaluationCriterionResult[];
  strengths: string[];
  gaps: string[];
  explanation: string;
};

export type EvaluationVerdict = 'MATCHED' | 'PARTIAL' | 'MISSING';

export type EvaluationEvidenceReference = {
  snippet: string;
  section: 'resume';
  startOffset: number;
  endOffset: number;
};

export type EvaluationCriterionResult = {
  criterionId: string;
  criterionText: string;
  verdict: EvaluationVerdict;
  scoreContribution: number;
  explanation: string;
  evidence: EvaluationEvidenceReference[];
};

export type ApplicantEvaluationV2Input = {
  jobSnapshot: JobSnapshotV2;
  resumeText: string;
};
