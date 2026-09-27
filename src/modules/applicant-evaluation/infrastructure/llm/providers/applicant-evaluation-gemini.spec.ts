import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  ApplicantEvaluationLlmOutput,
  ApplicantEvaluationLlmOutputV2,
} from '../../../application/interfaces/applicant-evaluation-llm.interface';
import {
  APPLICANT_EVALUATION_RESPONSE_SCHEMA,
  APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2,
} from '../applicant-evaluation-response.schema';
import { buildJobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { APPLICANT_EVALUATION_PROMPT_VERSION_V2 } from '../../../application/constants/applicant-evaluation.constants';
import { GeminiEvaluateApplicant } from './applicant-evaluation-gemini';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

describe('GeminiEvaluateApplicant', () => {
  const input = {
    jobSnapshot: {
      schemaVersion: 1 as const,
      publicId: 'job-id',
      title: 'Backend Engineer',
      description: 'Build backend services',
      requirements: 'TypeScript and NestJS',
      location: 'Remote',
      skills: [{ id: 1, name: 'TypeScript' }],
      category: { id: 2, name: 'Engineering' },
      arrangement: { id: 3, name: 'Remote' },
    },
    resumeText: 'Five years of TypeScript experience.',
    model: 'persisted-gemini-model',
    promptVersion: 'applicant-match-v1',
  };
  const output: ApplicantEvaluationLlmOutput = {
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

  let provider: GeminiEvaluateApplicant;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockGenerateContent.mockReset();
    const values: Record<string, string> = {
      LLM_EVALUATION_KEY: 'test-key',
      LLM_EVALUATION_MODEL: 'gemini-test-model',
    };
    const configService = {
      getOrThrow: jest.fn((key: string): string => values[key]),
    };
    provider = new GeminiEvaluateApplicant(
      configService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends input with the configured structured-output schema', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(output) });

    const result = await provider.evaluate(input);

    expect(result._unsafeUnwrap()).toEqual(output);
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: input.model,
      contents: JSON.stringify({
        job: input.jobSnapshot,
        resumeText: input.resumeText,
      }),
      config: {
        temperature: 0,
        systemInstruction: expect.any(String) as string,
        responseMimeType: 'application/json',
        responseJsonSchema: APPLICANT_EVALUATION_RESPONSE_SCHEMA,
      },
    });
  });

  it('selects the V2 schema and returns criterion-level output', async () => {
    const jobSnapshot = buildJobSnapshotV2(input.jobSnapshot);
    const v2Input = {
      ...input,
      jobSnapshot,
      promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION_V2,
    };
    const v2Output: ApplicantEvaluationLlmOutputV2 = {
      schemaVersion: 2,
      evidence: {
        schemaVersion: 2,
        strengths: ['TypeScript experience'],
        gaps: [],
        explanation: 'The resume supports the criterion.',
        criteria: [
          {
            criterionId: 'skill:1',
            criterionText: 'Experience with TypeScript',
            verdict: 'MATCHED',
            scoreContribution: 100,
            explanation: 'TypeScript work is present.',
            evidence: [
              {
                snippet: 'TypeScript',
                section: 'resume',
                startOffset: 14,
                endOffset: 24,
              },
            ],
          },
        ],
      },
    };
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(v2Output) });

    const result = await provider.evaluate(v2Input);

    expect(result._unsafeUnwrap()).toEqual(v2Output);
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: input.model,
      contents: JSON.stringify({
        job: {
          title: jobSnapshot.title,
          description: jobSnapshot.description,
          requirements: jobSnapshot.requirements,
          criteria: jobSnapshot.criteria,
        },
        resumeText: input.resumeText,
      }),
      config: {
        temperature: 0,
        systemInstruction: expect.stringContaining('untrusted data') as string,
        responseMimeType: 'application/json',
        responseJsonSchema: APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2,
      },
    });
  });

  it('keeps the V1 schema for a persisted V1 prompt with a V2 job snapshot', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(output) });

    const jobSnapshot = buildJobSnapshotV2(input.jobSnapshot);
    const result = await provider.evaluate({ ...input, jobSnapshot });

    expect(result._unsafeUnwrap()).toEqual(output);
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: input.model,
      contents: JSON.stringify({
        job: jobSnapshot,
        resumeText: input.resumeText,
      }),
      config: {
        temperature: 0,
        systemInstruction: expect.any(String) as string,
        responseMimeType: 'application/json',
        responseJsonSchema: APPLICANT_EVALUATION_RESPONSE_SCHEMA,
      },
    });
  });

  it('rejects a V1 response when a V2 prompt is requested', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(output) });

    const result = await provider.evaluate({
      ...input,
      jobSnapshot: buildJobSnapshotV2(input.jobSnapshot),
      promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION_V2,
    });

    expect(result._unsafeUnwrapErr().message).toBe(
      'Gemini returned an invalid evaluation response',
    );
  });

  it('returns an error when Gemini returns no text', async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });

    const result = await provider.evaluate(input);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe(
      'Gemini returned an empty response',
    );
  });

  it('returns an error when Gemini returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not-json' });

    const result = await provider.evaluate(input);

    expect(result.isErr()).toBe(true);
  });

  it('returns an error when Gemini returns JSON that violates the schema', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ ...output, overallScore: 101 }),
    });

    const result = await provider.evaluate(input);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe(
      'Gemini returned an invalid evaluation response',
    );
  });

  it('returns an error when the Gemini request fails', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini unavailable'));

    const result = await provider.evaluate(input);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Gemini unavailable');
  });
});
