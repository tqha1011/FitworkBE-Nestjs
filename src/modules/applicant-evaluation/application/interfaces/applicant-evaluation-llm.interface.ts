import { Result } from 'neverthrow';
import { JobSnapshot } from 'src/modules/job/domain/value-objects/job-snapshot';
import {
  EvaluationBreakdownV1,
  EvaluationEvidenceV1,
  EvaluationEvidenceV2,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationLlmInput = {
  demo?: boolean;
  jobSnapshot: JobSnapshot;
  resumeText: string;
  model: string;
  promptVersion: string;
};

export type ApplicantEvaluationLlmOutput = {
  schemaVersion: 1;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdownV1;
  evidence: EvaluationEvidenceV1;
};

export type ApplicantEvaluationLlmOutputV2 = {
  schemaVersion: 2;
  evidence: EvaluationEvidenceV2;
};

export abstract class IApplicantEvaluationLlm {
  abstract evaluate(
    input: ApplicantEvaluationLlmInput,
  ): Promise<
    Result<ApplicantEvaluationLlmOutput | ApplicantEvaluationLlmOutputV2, Error>
  >;
}
