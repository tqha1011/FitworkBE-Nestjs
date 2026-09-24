import { Result } from 'neverthrow';
import { JobSnapshot } from 'src/modules/job/domain/value-objects/job-snapshot';
import {
  EvaluationBreakdown,
  EvaluationCriterionResult,
  EvaluationEvidenceV1,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationLlmInput = {
  jobSnapshot: JobSnapshot;
  resumeText: string;
  model: string;
  promptVersion: string;
};

export type ApplicantEvaluationLlmOutput = {
  schemaVersion: 1;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdown;
  evidence: EvaluationEvidenceV1;
};

export type ApplicantEvaluationLlmOutputV2 = {
  schemaVersion: 2;
  criteria: EvaluationCriterionResult[];
};

export abstract class IApplicantEvaluationLlm {
  abstract evaluate(
    input: ApplicantEvaluationLlmInput,
  ): Promise<
    Result<ApplicantEvaluationLlmOutput | ApplicantEvaluationLlmOutputV2, Error>
  >;
}
