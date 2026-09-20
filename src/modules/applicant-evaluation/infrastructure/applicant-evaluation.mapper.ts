import { Prisma } from 'generated/prisma/client';
import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
} from '../domain/value-objects/evaluation';

export function mapEvaluationBreakdown(
  value: Prisma.JsonValue | null,
): EvaluationBreakdown | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    typeof value.skills !== 'number' ||
    typeof value.experience !== 'number' ||
    typeof value.education !== 'number' ||
    typeof value.overallFit !== 'number'
  ) {
    throw new Error('Evaluation score breakdown is invalid');
  }

  return {
    schemaVersion: 1,
    skills: value.skills,
    experience: value.experience,
    education: value.education,
    overallFit: value.overallFit,
  };
}

export function mapEvaluationEvidence(
  value: Prisma.JsonValue | null,
): EvaluationEvidenceV1 | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.strengths) ||
    !value.strengths.every((item) => typeof item === 'string') ||
    !Array.isArray(value.gaps) ||
    !value.gaps.every((item) => typeof item === 'string') ||
    typeof value.explanation !== 'string'
  ) {
    throw new Error('Evaluation evidence is invalid');
  }

  return {
    schemaVersion: 1,
    strengths: value.strengths,
    gaps: value.gaps,
    explanation: value.explanation,
  };
}
