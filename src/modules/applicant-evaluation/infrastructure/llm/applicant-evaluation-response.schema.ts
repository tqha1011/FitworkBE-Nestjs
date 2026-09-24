export const APPLICANT_EVALUATION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'overallScore', 'scoreBreakdown', 'evidence'],
  properties: {
    schemaVersion: {
      type: 'integer',
      enum: [1],
    },
    overallScore: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
    },
    scoreBreakdown: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'skills',
        'experience',
        'education',
        'overallFit',
      ],
      properties: {
        schemaVersion: {
          type: 'integer',
          enum: [1],
        },
        skills: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
        },
        experience: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
        },
        education: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
        },
        overallFit: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
        },
      },
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'strengths', 'gaps', 'explanation'],
      properties: {
        schemaVersion: {
          type: 'integer',
          enum: [1],
        },
        strengths: {
          type: 'array',
          items: { type: 'string' },
        },
        gaps: {
          type: 'array',
          items: { type: 'string' },
        },
        explanation: {
          type: 'string',
        },
      },
    },
  },
} as const;

export const APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2 = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'criteria'],
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'criterionId',
          'criterionText',
          'verdict',
          'scoreContribution',
          'explanation',
          'evidence',
        ],
        properties: {
          criterionId: { type: 'string' },
          criterionText: { type: 'string' },
          verdict: { type: 'string', enum: ['MATCHED', 'PARTIAL', 'MISSING'] },
          scoreContribution: { type: 'number', minimum: 0, maximum: 100 },
          explanation: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['snippet', 'section', 'startOffset', 'endOffset'],
              properties: {
                snippet: { type: 'string' },
                section: { type: 'string', enum: ['resume'] },
                startOffset: { type: 'integer', minimum: 0 },
                endOffset: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
      },
    },
  },
} as const;
