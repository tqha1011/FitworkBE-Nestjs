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
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { GeminiMetrics } from 'src/shared/observability/gemini-metrics';

@Injectable()
export class GeminiEvaluateApplicant implements IApplicantEvaluationLlm {
  private readonly logger = new Logger(GeminiEvaluateApplicant.name);
  private readonly tracer = trace.getTracer('evaluation.llm');
  private readonly telemetry = new GeminiMetrics();
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
    return this.tracer.startActiveSpan(
      'evaluation.llm.evaluate',
      async (span) => {
        const started = performance.now();
        let outcome: 'success' | 'error' = 'error';
        let stage: 'request' | 'json' | 'schema' = 'request';
        span.setAttribute('gen_ai.request.model', input.model);
        span.setAttribute('evaluation.prompt.version', input.promptVersion);
        try {
          const prompt = buildApplicantEvaluationPrompt(input);
          const isV2 =
            prompt.version === APPLICANT_EVALUATION_PROMPT_VERSION_V2;
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
          this.telemetry.usage(
            input.model,
            input.promptVersion,
            generatedResponse.usageMetadata,
          );
          if (!generatedResponse.text) {
            this.telemetry.validationFailure(
              input.model,
              input.promptVersion,
              'empty_response',
            );
            span.setStatus({ code: SpanStatusCode.ERROR });
            return err(new Error('Gemini returned an empty response'));
          }
          stage = 'json';
          const output: unknown = JSON.parse(generatedResponse.text);
          stage = 'schema';
          if (isV2) {
            if (!validateApplicantEvaluationOutputV2(output)) {
              this.telemetry.validationFailure(
                input.model,
                input.promptVersion,
                'schema',
              );
              span.setStatus({ code: SpanStatusCode.ERROR });
              return err(
                new Error('Gemini returned an invalid evaluation response'),
              );
            }
            outcome = 'success';
            span.setStatus({ code: SpanStatusCode.OK });
            return ok(output);
          }
          if (!validateApplicantEvaluationOutput(output)) {
            this.telemetry.validationFailure(
              input.model,
              input.promptVersion,
              'schema',
            );
            span.setStatus({ code: SpanStatusCode.ERROR });
            return err(
              new Error('Gemini returned an invalid evaluation response'),
            );
          }
          outcome = 'success';
          span.setStatus({ code: SpanStatusCode.OK });
          return ok(output);
        } catch (error) {
          if (stage === 'json') {
            this.telemetry.validationFailure(
              input.model,
              input.promptVersion,
              'json',
            );
          }
          span.setStatus({ code: SpanStatusCode.ERROR });
          this.logger.error('Failed to evaluate applicant with Gemini', error);

          return err(
            error instanceof Error
              ? error
              : new Error(`Gemini evaluation failed: ${String(error)}`, {
                  cause: error,
                }),
          );
        } finally {
          this.telemetry.complete(
            input.model,
            input.promptVersion,
            (performance.now() - started) / 1000,
            outcome,
          );
          span.end();
        }
      },
    );
  }
}
