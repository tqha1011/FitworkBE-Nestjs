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
