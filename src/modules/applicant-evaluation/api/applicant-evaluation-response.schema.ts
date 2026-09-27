import type { ApiResponseSchemaHost } from '@nestjs/swagger';

type Schema = ApiResponseSchemaHost['schema'];

const breakdownV1: Schema = {
  type: 'object',
  required: [
    'schemaVersion',
    'skills',
    'experience',
    'education',
    'overallFit',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    skills: { type: 'number' },
    experience: { type: 'number' },
    education: { type: 'number' },
    overallFit: { type: 'number' },
  },
};

const breakdownV2: Schema = {
  type: 'object',
  required: ['schemaVersion', 'criteria'],
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterionId', 'scoreContribution'],
        properties: {
          criterionId: { type: 'string' },
          scoreContribution: { type: 'number' },
        },
      },
    },
  },
};

const evidenceV1: Schema = {
  type: 'object',
  required: ['schemaVersion', 'strengths', 'gaps', 'explanation'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
  },
};

const evidenceV2: Schema = {
  type: 'object',
  required: ['schemaVersion', 'criteria', 'strengths', 'gaps', 'explanation'],
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
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
          scoreContribution: { type: 'number' },
          explanation: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['snippet', 'section', 'startOffset', 'endOffset'],
              properties: {
                snippet: { type: 'string' },
                section: { type: 'string', enum: ['resume'] },
                startOffset: { type: 'integer' },
                endOffset: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
  },
};

const detailV1: Schema = {
  type: 'object',
  required: ['publicId', 'overallScore', 'scoreBreakdown', 'evidence'],
  properties: {
    publicId: { type: 'string', format: 'uuid' },
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    scoreBreakdown: breakdownV1,
    evidence: evidenceV1,
  },
};

const detailV2: Schema = {
  type: 'object',
  required: ['publicId', 'overallScore', 'scoreBreakdown', 'evidence'],
  properties: {
    publicId: { type: 'string', format: 'uuid' },
    overallScore: { type: 'integer', minimum: 0, maximum: 100 },
    scoreBreakdown: breakdownV2,
    evidence: evidenceV2,
  },
};

const ownerFields: NonNullable<Schema['properties']> = {
  decisionSupportOnly: { type: 'boolean', enum: [true] },
  resumeRedaction: {
    type: 'object',
    required: ['redactedResumeText', 'redactedResumeVersion'],
    properties: {
      redactedResumeText: { type: 'string', nullable: true },
      redactedResumeVersion: { type: 'string', nullable: true },
    },
  },
  metadata: {
    type: 'object',
    required: [
      'jobContentHash',
      'resumeContentHash',
      'redactedResumeHash',
      'parserVersion',
      'redactionVersion',
      'model',
      'promptVersion',
    ],
    properties: {
      jobContentHash: { type: 'string' },
      resumeContentHash: { type: 'string' },
      redactedResumeHash: { type: 'string', nullable: true },
      parserVersion: { type: 'string' },
      redactionVersion: { type: 'string', nullable: true },
      model: { type: 'string' },
      promptVersion: { type: 'string' },
    },
  },
};

export const APPLICANT_EVALUATION_DETAIL_RESPONSE_SCHEMA: Schema = {
  oneOf: [detailV1, detailV2],
};

export const APPLICANT_EVALUATION_OWNER_RESPONSE_SCHEMA: Schema = {
  oneOf: [
    {
      ...detailV1,
      required: [...(detailV1.required ?? []), ...Object.keys(ownerFields)],
      properties: { ...detailV1.properties, ...ownerFields },
    },
    {
      ...detailV2,
      required: [...(detailV2.required ?? []), ...Object.keys(ownerFields)],
      properties: { ...detailV2.properties, ...ownerFields },
    },
  ],
};
