import { JobCriterion } from 'src/modules/job/domain/value-objects/job-snapshot';
import {
  EvaluationBreakdownV2,
  EvaluationEvidenceV2,
} from '../../domain/value-objects/evaluation';

export type ValidatedEvaluationV2 = {
  evidence: EvaluationEvidenceV2;
  scoreBreakdown: EvaluationBreakdownV2;
  overallScore: number;
};

export function validateEvaluationV2(
  jobCriteria: JobCriterion[],
  resumeText: string,
  evidence: EvaluationEvidenceV2,
): ValidatedEvaluationV2 {
  const invalid = (): never => {
    throw new Error('Invalid evaluation V2 response');
  };

  if (
    jobCriteria.length === 0 ||
    evidence.criteria.length !== jobCriteria.length
  ) {
    invalid();
  }

  const jobsById = new Map(
    jobCriteria.map((criterion) => [criterion.id, criterion]),
  );
  if (jobsById.size !== jobCriteria.length) {
    invalid();
  }

  const seen = new Set<string>();
  let total = 0;
  for (const result of evidence.criteria) {
    const job = jobsById.get(result.criterionId);
    if (
      !job ||
      seen.has(result.criterionId) ||
      result.criterionText !== job.text ||
      !Number.isFinite(result.scoreContribution) ||
      result.scoreContribution < 0 ||
      result.scoreContribution > job.weight
    ) {
      invalid();
    }
    seen.add(result.criterionId);

    if (
      (result.verdict === 'MISSING' && result.scoreContribution !== 0) ||
      ((result.verdict === 'MATCHED' || result.verdict === 'PARTIAL') &&
        (result.scoreContribution <= 0 || result.evidence.length === 0)) ||
      !['MATCHED', 'PARTIAL', 'MISSING'].includes(result.verdict)
    ) {
      invalid();
    }

    for (const reference of result.evidence) {
      if (
        reference.section !== 'resume' ||
        !Number.isInteger(reference.startOffset) ||
        !Number.isInteger(reference.endOffset) ||
        reference.startOffset < 0 ||
        reference.endOffset <= reference.startOffset ||
        reference.endOffset > resumeText.length ||
        resumeText.slice(reference.startOffset, reference.endOffset) !==
          reference.snippet
      ) {
        invalid();
      }
    }
    total += result.scoreContribution;
  }

  if (
    seen.size !== jobCriteria.length ||
    !Number.isFinite(total) ||
    total < 0 ||
    total > 100
  ) {
    invalid();
  }

  return {
    evidence,
    scoreBreakdown: {
      schemaVersion: 2,
      criteria: evidence.criteria.map(({ criterionId, scoreContribution }) => ({
        criterionId,
        scoreContribution,
      })),
    },
    overallScore: Math.round(total),
  };
}
