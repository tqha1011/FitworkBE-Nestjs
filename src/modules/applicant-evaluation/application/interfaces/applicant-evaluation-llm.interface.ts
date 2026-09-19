import { Result } from 'neverthrow';
import { JobSnapshotV1 } from 'src/modules/job/domain/value-objects/job-snapshot';
import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationLlmInput = {
  jobSnapshot: JobSnapshotV1;
  resumeText: string;
};

export type ApplicantEvaluationLlmOutput = {
  schemaVersion: 1;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdown;
  evidence: EvaluationEvidenceV1;
};

export abstract class IApplicantEvaluationLlm {
  abstract evaluate(
    input: ApplicantEvaluationLlmInput,
  ): Promise<Result<ApplicantEvaluationLlmOutput, Error>>;
}
