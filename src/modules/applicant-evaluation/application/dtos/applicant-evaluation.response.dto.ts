import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
  EvaluationEvidenceV2,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationResponseDto = {
  publicId: string;
};

export type ApplicantEvaluationDetailDto = {
  publicId: string;
  overallScore: number;
  evidence: EvaluationEvidenceV1 | EvaluationEvidenceV2;
  scoreBreakdown: EvaluationBreakdown;
};
