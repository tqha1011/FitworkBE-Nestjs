import { JobCriterion } from 'src/modules/job/domain/value-objects/job-snapshot';
import { EvaluationEvidenceV2 } from '../../domain/value-objects/evaluation';
import {
  resolveEvaluationV2EvidenceOffsets,
  validateEvaluationV2,
} from './evaluation-v2-validator';

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
    ['TypeScript', 'TypeScript', 2, 8, 0, 10],
    ['TypeScript', 'TypeScript', 200, 300, 0, 10],
    ['TypeScript and TypeScript', 'TypeScript', 15, 25, 15, 25],
    ['TypeScript and TypeScript', 'TypeScript', 2, 8, 2, 8],
    ['TypeScript', 'Fabricated', 0, 10, 0, 10],
    ['TypeScript', '', 0, 10, 0, 10],
  ] as const)(
    'resolves only an exact unambiguous quote in %s (%s, %i..%i)',
    (resume, snippet, startOffset, endOffset, expectedStart, expectedEnd) => {
      const input = {
        ...evidence,
        criteria: [
          {
            ...evidence.criteria[0],
            evidence: [
              { snippet, section: 'resume' as const, startOffset, endOffset },
            ],
          },
        ],
      };
      const resolved = resolveEvaluationV2EvidenceOffsets(resume, input);
      expect(resolved.criteria[0].evidence[0]).toEqual({
        snippet,
        section: 'resume',
        startOffset: expectedStart,
        endOffset: expectedEnd,
      });
      expect(input.criteria[0].evidence[0]).toEqual({
        snippet,
        section: 'resume',
        startOffset,
        endOffset,
      });
    },
  );

  it('reports the evidence mismatch without exposing resume text', () => {
    const wrongEvidence = {
      ...evidence,
      criteria: [
        {
          ...evidence.criteria[0],
          evidence: [
            {
              ...evidence.criteria[0].evidence[0],
              snippet: 'private fabricated claim',
            },
          ],
        },
        evidence.criteria[1],
      ],
    };
    try {
      validateEvaluationV2(jobCriteria, resumeText, wrongEvidence);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({ code: 'V2_EVIDENCE_SNIPPET_NOT_FOUND' }),
      );
      expect((error as Error).message).toContain(
        'snippet is not present in resume',
      );
      expect((error as Error).message).not.toContain('private fabricated');
    }
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
      'MATCHED without evidence',
      [{ ...evidence.criteria[0], evidence: [] }, evidence.criteria[1]],
    ],
    [
      'PARTIAL without evidence',
      [evidence.criteria[0], { ...evidence.criteria[1], evidence: [] }],
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
