import { metrics } from '@opentelemetry/api';

const TOKEN_FIELDS = {
  promptTokenCount: 'prompt',
  candidatesTokenCount: 'candidates',
  thoughtsTokenCount: 'thoughts',
  cachedContentTokenCount: 'cached',
  toolUsePromptTokenCount: 'tool_use_prompt',
  totalTokenCount: 'total',
} as const;

type TokenField = keyof typeof TOKEN_FIELDS;
type Labels = { model: string; prompt_version: string };

export class GeminiMetrics {
  private readonly meter = metrics.getMeter('fitwork.gemini');
  private readonly requests = this.meter.createCounter(
    'fitwork_gemini_requests_total',
  );
  private readonly duration = this.meter.createHistogram(
    'fitwork_gemini_duration_seconds',
    { unit: 's' },
  );
  private readonly failures = this.meter.createCounter(
    'fitwork_gemini_validation_failures_total',
  );
  private readonly tokens = this.meter.createCounter(
    'fitwork_gemini_tokens_total',
  );
  private readonly unavailable = this.meter.createCounter(
    'fitwork_gemini_usage_unavailable_total',
  );

  usage(
    model: string,
    promptVersion: string,
    usage?: Partial<Record<TokenField, number>>,
  ): void {
    const labels = this.labels(model, promptVersion);
    if (!usage) {
      this.unavailable.add(1, labels);
      return;
    }
    for (const [field, tokenType] of Object.entries(TOKEN_FIELDS)) {
      const value = usage[field as TokenField];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        this.tokens.add(value, { ...labels, token_type: tokenType });
      }
    }
  }

  complete(
    model: string,
    promptVersion: string,
    seconds: number,
    outcome: 'success' | 'error',
  ): void {
    const labels = this.labels(model, promptVersion);
    this.requests.add(1, { ...labels, outcome });
    this.duration.record(seconds, { ...labels, outcome });
  }

  validationFailure(
    model: string,
    promptVersion: string,
    stage: 'empty_response' | 'json' | 'schema' | 'evidence',
  ): void {
    this.failures.add(1, { ...this.labels(model, promptVersion), stage });
  }

  private labels(model: string, promptVersion: string): Labels {
    return { model, prompt_version: promptVersion };
  }
}
