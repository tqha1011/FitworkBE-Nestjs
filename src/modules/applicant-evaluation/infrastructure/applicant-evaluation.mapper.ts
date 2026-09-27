import { Prisma } from 'generated/prisma/client';
import {
  EvaluationBreakdown,
  EvaluationEvidenceV1,
  EvaluationEvidenceV2,
} from '../domain/value-objects/evaluation';
import { validateApplicantEvaluationOutputV2 } from './llm/applicant-evaluation-response.validator';

export function mapEvaluationBreakdown(
  value: Prisma.JsonValue | null,
): EvaluationBreakdown | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.schemaVersion === 2
  ) {
    if (!Array.isArray(value.criteria)) {
      throw new Error('Evaluation score breakdown is invalid');
    }
    const criteria: Array<{ criterionId: string; scoreContribution: number }> =
      [];
    for (const item of value.criteria) {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item) ||
        typeof item.criterionId !== 'string' ||
        typeof item.scoreContribution !== 'number' ||
        !Number.isFinite(item.scoreContribution) ||
        item.scoreContribution < 0 ||
        item.scoreContribution > 100
      ) {
        throw new Error('Evaluation score breakdown is invalid');
      }
      criteria.push({
        criterionId: item.criterionId,
        scoreContribution: item.scoreContribution,
      });
    }
    return {
      schemaVersion: 2,
      criteria,
    };
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
): EvaluationEvidenceV1 | EvaluationEvidenceV2 | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.schemaVersion === 2
  ) {
    const output: unknown = { schemaVersion: 2, evidence: value };
    if (!validateApplicantEvaluationOutputV2(output)) {
      throw new Error('Evaluation evidence is invalid');
    }
    return output.evidence;
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
