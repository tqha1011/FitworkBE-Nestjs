import { ApplicantEvaluationLlmOutput } from '../../application/interfaces/applicant-evaluation-llm.interface';
import { validateApplicantEvaluationOutput } from './applicant-evaluation-response.validator';

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
