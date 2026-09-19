import { Logger } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import {
  ApplicantEvaluationLlmInput,
  ApplicantEvaluationLlmOutput,
  IApplicantEvaluationLlm,
} from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { buildApplicantEvaluationPrompt } from '../applicant-evaluation-prompt.builder';
import { APPLICANT_EVALUATION_RESPONSE_SCHEMA } from '../applicant-evaluation-response.schema';
import { validateApplicantEvaluationOutput } from '../applicant-evaluation-response.validator';

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
  ): Promise<Result<ApplicantEvaluationLlmOutput, Error>> {
    try {
      const prompt = buildApplicantEvaluationPrompt(input);
      const generatedResponse = await this.client.models.generateContent({
        model: this.configService.getOrThrow<string>('LLM_EVALUATION_MODEL'),
        contents: prompt.user,
        config: {
          temperature: 0,
          systemInstruction: prompt.system,
          responseMimeType: 'application/json',
          responseJsonSchema: APPLICANT_EVALUATION_RESPONSE_SCHEMA,
        },
      });
      if (!generatedResponse.text) {
        return err(new Error('Gemini returned an empty response'));
      }
      const output: unknown = JSON.parse(generatedResponse.text);
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
