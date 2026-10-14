import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
  EvaluationEvidenceV2,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationResponseDto = {
  publicId: string;
};

export type ApplicantEvaluationDetailDto = {
  source?: 'SAMPLE' | 'LIVE';
  publicId: string;
  overallScore: number;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2;
  scoreBreakdown: EvaluationBreakdown;
};

export type ApplicantEvaluationForJobOwnerDto = {
  source?: 'SAMPLE' | 'LIVE';
  publicId: string;
  overallScore: number;
  scoreBreakdown: EvaluationBreakdown;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2;
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
