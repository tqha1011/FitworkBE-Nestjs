import { Result } from 'neverthrow';
import { JobSnapshot } from 'src/modules/job/domain/value-objects/job-snapshot';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
  EvaluationEvidenceV2,
} from '../value-objects/evaluation';

export type PrepareApplicantEvaluationInput = {
  applicantPublicId: string;
  jobId: number;
  resumeId: number;
  resumeContentId: number;
  jobSnapshot: JobSnapshot;
  jobContentHash: string;
  resumeContentHash: string;
  parserVersion: string;
  model: string;
  promptVersion: string;
  redactedResumeText: string;
  redactedResumeHash: string;
  redactionVersion: string;
};

export type PreparedApplicantEvaluation = {
  publicId: string;
  status: CommonEvaluationStatus;
  resetFromFailed: boolean;
};

export type ApplicantEvaluationProcessingData = {
  publicId: string;
  jobSnapshot: JobSnapshot;
  model: string;
  promptVersion: string;
  resumeRedactedText: string;
  resumeRedactedHash: string;
  resumeRedactionVersion: string;
};

export type CompleteApplicantEvaluationInput = {
  evaluationPublicId: string;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdown;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2;
};

export type ApplicantEvaluationRealtimeState = {
  evaluationPublicId: string;
  status: CommonEvaluationStatus;
  overallScore: number | null;
  errorMessage: string | null;
  updatedAt: Date;
};

export type ApplicantEvaluationDetail = {
  evaluationPublicId: string;
  overallScore: number | null;
  scoreBreakdown: EvaluationBreakdown | null;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2 | null;
};

export type ApplicantEvaluationForJobOwner = {
  publicId: string;
  overallScore: number | null;
  scoreBreakdown: EvaluationBreakdown | null;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2 | null;
  decisionSupportOnly: true;
  resumeRedaction: {
    redactedResumeText: string | null;
    redactedResumeVersion: string | null;
  };
  metadata: {
    jobContentHash: string;
    resumeContentHash: string;
    redactedResumeHash: string | null;
    parserVersion: string;
    redactionVersion: string | null;
    model: string;
    promptVersion: string;
  };
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

  abstract getRealtimeStateForApplicant(
    evaluationPublicId: string,
    applicantPublicId: string,
  ): Promise<Result<ApplicantEvaluationRealtimeState | null, Error>>;

  abstract getApplicantEvaluationDetail(
    applicantPublicId: string,
    jobPublicId: string,
  ): Promise<Result<ApplicantEvaluationDetail | null, Error>>;

  abstract getApplicantEvaluationForJobOwner(
    evaluationPublicId: string,
    jobPublicId: string,
  ): Promise<Result<ApplicantEvaluationForJobOwner | null, Error>>;
}
