import { JobCriterion } from 'src/modules/job/domain/value-objects/job-snapshot';
import { EvaluationEvidenceV2 } from '../../domain/value-objects/evaluation';
import { validateEvaluationV2 } from './evaluation-v2-validator';

describe('validateEvaluationV2', () => {
  const jobCriteria: JobCriterion[] = [
    {
      id: 'skill:1',
      text: 'TypeScript',
      category: 'SKILL',
      weight: 50,
      required: false,
    },
    {
      id: 'skill:2',
      text: 'PostgreSQL',
      category: 'SKILL',
      weight: 50,
      required: false,
    },
  ];
  const resumeText = 'Tôi dùng TypeScript và PostgreSQL.';
  const evidence: EvaluationEvidenceV2 = {
    schemaVersion: 2,
    strengths: ['TypeScript'],
    gaps: [],
    explanation: 'Both skills appear.',
    criteria: [
      {
        criterionId: 'skill:1',
        criterionText: 'TypeScript',
        verdict: 'MATCHED',
        scoreContribution: 45,
        explanation: 'Used TypeScript.',
        evidence: [
          {
            snippet: 'TypeScript',
            section: 'resume',
            startOffset: 9,
            endOffset: 19,
          },
        ],
      },
      {
        criterionId: 'skill:2',
        criterionText: 'PostgreSQL',
        verdict: 'PARTIAL',
        scoreContribution: 25.5,
        explanation: 'Used PostgreSQL.',
        evidence: [
          {
            snippet: 'PostgreSQL',
            section: 'resume',
            startOffset: 23,
            endOffset: 33,
          },
        ],
      },
    ],
  };

  it('validates every snippet against the Unicode resume and counts PARTIAL once', () => {
    expect(validateEvaluationV2(jobCriteria, resumeText, evidence)).toEqual({
      evidence,
      scoreBreakdown: {
        schemaVersion: 2,
        criteria: [
          { criterionId: 'skill:1', scoreContribution: 45 },
          { criterionId: 'skill:2', scoreContribution: 25.5 },
        ],
      },
      overallScore: 71,
    });
  });

  it.each([
    ['missing criterion', [evidence.criteria[0]]],
    ['duplicate criterion', [evidence.criteria[0], evidence.criteria[0]]],
    [
      'unknown criterion',
      [
        { ...evidence.criteria[0], criterionId: 'unknown' },
        evidence.criteria[1],
      ],
    ],
    [
      'changed criterion text',
      [
        { ...evidence.criteria[0], criterionText: 'Changed' },
        evidence.criteria[1],
      ],
    ],
    [
      'invalid verdict',
      [{ ...evidence.criteria[0], verdict: 'UNKNOWN' }, evidence.criteria[1]],
    ],
    [
      'positive verdict without evidence',
      [{ ...evidence.criteria[0], evidence: [] }, evidence.criteria[1]],
    ],
    [
      'missing verdict with a score',
      [{ ...evidence.criteria[0], verdict: 'MISSING' }, evidence.criteria[1]],
    ],
    [
      'score exceeds weight',
      [
        { ...evidence.criteria[0], scoreContribution: 51 },
        evidence.criteria[1],
      ],
    ],
    [
      'negative score',
      [
        { ...evidence.criteria[0], scoreContribution: -1 },
        evidence.criteria[1],
      ],
    ],
    [
      'NaN score',
      [
        { ...evidence.criteria[0], scoreContribution: NaN },
        evidence.criteria[1],
      ],
    ],
    [
      'wrong snippet',
      [
        {
          ...evidence.criteria[0],
          evidence: [
            { ...evidence.criteria[0].evidence[0], snippet: 'JavaScript' },
          ],
        },
        evidence.criteria[1],
      ],
    ],
    [
      'negative offset',
      [
        {
          ...evidence.criteria[0],
          evidence: [{ ...evidence.criteria[0].evidence[0], startOffset: -1 }],
        },
        evidence.criteria[1],
      ],
    ],
    [
      'offset past end',
      [
        {
          ...evidence.criteria[0],
          evidence: [{ ...evidence.criteria[0].evidence[0], endOffset: 100 }],
        },
        evidence.criteria[1],
      ],
    ],
  ])('rejects %s', (_case, criteria) => {
    expect(() =>
      validateEvaluationV2(jobCriteria, resumeText, {
        ...evidence,
        criteria: criteria as EvaluationEvidenceV2['criteria'],
      }),
    ).toThrow('Invalid evaluation V2 response');
  });
});
