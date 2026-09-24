import { Injectable, Logger } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import {
  ApplicantEvaluationLlmInput,
  ApplicantEvaluationLlmOutput,
  ApplicantEvaluationLlmOutputV2,
  IApplicantEvaluationLlm,
} from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { buildApplicantEvaluationPrompt } from '../applicant-evaluation-prompt.builder';
import {
  APPLICANT_EVALUATION_RESPONSE_SCHEMA,
  APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2,
} from '../applicant-evaluation-response.schema';
import {
  validateApplicantEvaluationOutput,
  validateApplicantEvaluationOutputV2,
} from '../applicant-evaluation-response.validator';
import { APPLICANT_EVALUATION_PROMPT_VERSION_V2 } from '../../../application/constants/applicant-evaluation.constants';

@Injectable()
export class GeminiEvaluateApplicant implements IApplicantEvaluationLlm {
  private readonly logger = new Logger(GeminiEvaluateApplicant.name);
  private readonly client: GoogleGenAI;
  constructor(private readonly configService: ConfigService) {
    this.client = new GoogleGenAI({
      apiKey: this.configService.getOrThrow<string>('LLM_EVALUATION_KEY'),
    });
  }
  async evaluate(
    input: ApplicantEvaluationLlmInput,
  ): Promise<
    Result<ApplicantEvaluationLlmOutput | ApplicantEvaluationLlmOutputV2, Error>
  > {
    try {
      const prompt = buildApplicantEvaluationPrompt(input);
      const isV2 = prompt.version === APPLICANT_EVALUATION_PROMPT_VERSION_V2;
      const generatedResponse = await this.client.models.generateContent({
        model: input.model,
        contents: prompt.user,
        config: {
          temperature: 0,
          systemInstruction: prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: isV2
            ? APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2
            : APPLICANT_EVALUATION_RESPONSE_SCHEMA,
        },
      });
      if (!generatedResponse.text) {
        return err(new Error('Gemini returned an empty response'));
      }
      const output: unknown = JSON.parse(generatedResponse.text);
      if (isV2) {
        if (!validateApplicantEvaluationOutputV2(output)) {
          return err(
            new Error('Gemini returned an invalid evaluation response'),
          );
        }
        return ok(output);
      }
      if (!validateApplicantEvaluationOutput(output)) {
        return err(new Error('Gemini returned an invalid evaluation response'));
      }
      return ok(output);
    } catch (error) {
      this.logger.error('Failed to evaluate applicant with Gemini', error);

      return err(
        error instanceof Error
          ? error
          : new Error(`Gemini evaluation failed: ${String(error)}`),
      );
    }
  }
}
