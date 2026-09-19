import { Result } from 'neverthrow';
import { JobSnapshotV1 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
} from '../value-objects/evaluation';

export type PrepareApplicantEvaluationInput = {
  applicantPublicId: string;
  jobId: number;
  resumeId: number;
  resumeContentId: number;
  jobSnapshot: JobSnapshotV1;
  jobContentHash: string;
  resumeContentHash: string;
  parserVersion: string;
  model: string;
  promptVersion: string;
};

export type PreparedApplicantEvaluation = {
  publicId: string;
  status: CommonEvaluationStatus;
  resetFromFailed: boolean;
};

export type ApplicantEvaluationProcessingData = {
  publicId: string;
  jobSnapshot: JobSnapshotV1;
  resumeText: string;
  model: string;
  promptVersion: string;
};

export type CompleteApplicantEvaluationInput = {
  evaluationPublicId: string;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdown;
  evidence: EvaluationEvidenceV1;
};

export abstract class IApplicantEvaluationRepository {
  abstract prepare(
    input: PrepareApplicantEvaluationInput,
  ): Promise<Result<PreparedApplicantEvaluation | null, Error>>;

  abstract claimForProcessing(
    evaluationPublicId: string,
  ): Promise<Result<ApplicantEvaluationProcessingData | null, Error>>;

  abstract markCompleted(
    input: CompleteApplicantEvaluationInput,
  ): Promise<Result<boolean, Error>>;

  abstract markPending(
    evaluationPublicId: string,
    errorMessage: string,
  ): Promise<Result<boolean, Error>>;

  abstract markFailed(
    evaluationPublicId: string,
    errorMessage: string,
  ): Promise<Result<boolean, Error>>;
}
