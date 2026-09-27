import {
  mapEvaluationBreakdown,
  mapEvaluationEvidence,
} from './applicant-evaluation.mapper';

describe('applicant evaluation JSON mappers', () => {
  it('reads V1 evidence and breakdown', () => {
    const breakdown = {
      schemaVersion: 1,
      skills: 80,
      experience: 70,
      education: 60,
      overallFit: 75,
    };
    const evidence = {
      schemaVersion: 1,
      strengths: ['TypeScript'],
      gaps: [],
      explanation: 'Relevant.',
    };

    expect(mapEvaluationBreakdown(breakdown)).toEqual(breakdown);
    expect(mapEvaluationEvidence(evidence)).toEqual(evidence);
  });

  it('reads V2 evidence and breakdown', () => {
    const breakdown = {
      schemaVersion: 2,
      criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
    };
    const evidence = {
      schemaVersion: 2,
      strengths: ['TypeScript'],
      gaps: [],
      explanation: 'Relevant.',
      criteria: [
        {
          criterionId: 'skill:1',
          criterionText: 'TypeScript',
          verdict: 'PARTIAL',
          scoreContribution: 42,
          explanation: 'Mentioned.',
          evidence: [
            {
              snippet: 'TypeScript',
              section: 'resume',
              startOffset: 0,
              endOffset: 10,
            },
          ],
        },
      ],
    };

    expect(mapEvaluationBreakdown(breakdown)).toEqual(breakdown);
    expect(mapEvaluationEvidence(evidence)).toEqual(evidence);
  });

  it('rejects malformed V2 evidence', () => {
    expect(() =>
      mapEvaluationEvidence({ schemaVersion: 2, criteria: [] }),
    ).toThrow('Evaluation evidence is invalid');
  });
});
