import {
  ApplicantEvaluationLlmOutput,
  ApplicantEvaluationLlmOutputV2,
} from '../../application/interfaces/applicant-evaluation-llm.interface';
import {
  validateApplicantEvaluationOutput,
  validateApplicantEvaluationOutputV2,
} from './applicant-evaluation-response.validator';

describe('validateApplicantEvaluationOutput', () => {
  const validOutput: ApplicantEvaluationLlmOutput = {
    schemaVersion: 1,
    overallScore: 88,
    scoreBreakdown: {
      schemaVersion: 1,
      skills: 95,
      experience: 85,
      education: 75,
      overallFit: 90,
    },
    evidence: {
      schemaVersion: 1,
      strengths: ['Strong TypeScript experience'],
      gaps: ['No PostgreSQL evidence'],
      explanation: 'The resume matches most core requirements.',
    },
  };

  it('accepts an output matching the evaluation schema', () => {
    expect(validateApplicantEvaluationOutput(validOutput)).toBe(true);
  });

  it.each([
    ['a required field is missing', { ...validOutput, evidence: undefined }],
    ['an extra field is present', { ...validOutput, recommendation: 'hire' }],
    ['a score exceeds its maximum', { ...validOutput, overallScore: 101 }],
    ['a score is not an integer', { ...validOutput, overallScore: 88.5 }],
    [
      'evidence contains a non-string item',
      {
        ...validOutput,
        evidence: { ...validOutput.evidence, strengths: [42] },
      },
    ],
  ])('rejects output when %s', (_caseName, output) => {
    expect(validateApplicantEvaluationOutput(output)).toBe(false);
  });
});

describe('validateApplicantEvaluationOutputV2', () => {
  const validOutput: ApplicantEvaluationLlmOutputV2 = {
    schemaVersion: 2,
    criteria: [
      {
        criterionId: 'skill:1',
        criterionText: 'Experience with TypeScript',
        verdict: 'MATCHED',
        scoreContribution: 50,
        explanation: 'Built TypeScript services.',
        evidence: [
          {
            snippet: 'Built TypeScript services.',
            section: 'resume',
            startOffset: 0,
            endOffset: 26,
          },
        ],
      },
    ],
  };

  it('accepts a criterion-level response without an overall score', () => {
    expect(validateApplicantEvaluationOutputV2(validOutput)).toBe(true);
    expect(validateApplicantEvaluationOutput(validOutput)).toBe(false);
  });

  it.each([
    ['missing criteria', { schemaVersion: 2 }],
    ['unexpected overall score', { ...validOutput, overallScore: 50 }],
    [
      'wrong verdict',
      {
        ...validOutput,
        criteria: [{ ...validOutput.criteria[0], verdict: 'UNKNOWN' }],
      },
    ],
    [
      'wrong evidence section',
      {
        ...validOutput,
        criteria: [
          {
            ...validOutput.criteria[0],
            evidence: [
              { ...validOutput.criteria[0].evidence[0], section: 'job' },
            ],
          },
        ],
      },
    ],
    [
      'negative offset',
      {
        ...validOutput,
        criteria: [
          {
            ...validOutput.criteria[0],
            evidence: [
              { ...validOutput.criteria[0].evidence[0], startOffset: -1 },
            ],
          },
        ],
      },
    ],
  ])('rejects %s', (_caseName, output) => {
    expect(validateApplicantEvaluationOutputV2(output)).toBe(false);
  });
});
