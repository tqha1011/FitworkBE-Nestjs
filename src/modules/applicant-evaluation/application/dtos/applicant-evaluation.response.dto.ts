import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
} from '../../domain/value-objects/evaluation';

export type ApplicantEvaluationResponseDto = {
  publicId: string;
};

export type ApplicantEvaluationDetailDto = {
  publicId: string;
  overallScore: number;
  evidence: EvaluationEvidenceV1;
  scoreBreakdown: EvaluationBreakdown;
};
