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

/** Resolve positions ourselves only when an exact quote has one unambiguous match. */
export function resolveEvaluationV2EvidenceOffsets(
  resumeText: string,
  evidence: EvaluationEvidenceV2,
): EvaluationEvidenceV2 {
  const criteria = evidence.criteria.map((criterion) => {
    const references = criterion.evidence.map((reference) => {
      const { snippet, startOffset, endOffset } = reference;
      if (
        startOffset >= 0 &&
        endOffset > startOffset &&
        endOffset <= resumeText.length &&
        resumeText.slice(startOffset, endOffset) === snippet
      ) {
        return reference;
      }

      const start = resumeText.indexOf(snippet);
      if (
        !snippet ||
        start === -1 ||
        resumeText.indexOf(snippet, start + 1) !== -1
      ) {
        return reference; // Leave unverifiable evidence for the strict validator to reject.
      }
      return {
        ...reference,
        startOffset: start,
        endOffset: start + snippet.length,
      };
    });
    return { ...criterion, evidence: references };
  });
  return { ...evidence, criteria };
}

export function validateEvaluationV2(
  jobCriteria: JobCriterion[],
  resumeText: string,
  evidence: EvaluationEvidenceV2,
): ValidatedEvaluationV2 {
  const invalid = (reason?: string, code = 'V2_INVALID_RESPONSE'): never => {
    const message = reason
      ? `Invalid evaluation V2 response: ${reason}`
      : 'Invalid evaluation V2 response';
    throw Object.assign(new Error(message), { code });
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
        reference.endOffset > resumeText.length
      ) {
        invalid(
          'evidence reference has an invalid section or offset range',
          'V2_EVIDENCE_REFERENCE_INVALID',
        );
      }
      if (
        resumeText.slice(reference.startOffset, reference.endOffset) !==
        reference.snippet
      ) {
        const firstMatch = resumeText.indexOf(reference.snippet);
        if (!reference.snippet || firstMatch === -1) {
          invalid(
            'evidence snippet is not present in resume',
            'V2_EVIDENCE_SNIPPET_NOT_FOUND',
          );
        }
        if (resumeText.indexOf(reference.snippet, firstMatch + 1) !== -1) {
          invalid(
            'evidence snippet has multiple matches and its offsets are invalid',
            'V2_EVIDENCE_AMBIGUOUS',
          );
        }
        invalid(
          'evidence offsets do not match the snippet',
          'V2_EVIDENCE_OFFSET_MISMATCH',
        );
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
