import { metrics } from '@opentelemetry/api';
import { GeminiMetrics } from './gemini-metrics';

describe('GeminiMetrics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('records each available token count once without deriving total', () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn().mockReturnValue({ add }),
      createHistogram: jest.fn().mockReturnValue({ record: jest.fn() }),
    } as never);
    const telemetry = new GeminiMetrics();

    telemetry.usage('gemini-model', 'v2', {
      promptTokenCount: 100,
      cachedContentTokenCount: 20,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 10,
      totalTokenCount: 140,
    });

    expect(add).toHaveBeenCalledWith(140, {
      model: 'gemini-model',
      prompt_version: 'v2',
      token_type: 'total',
    });
    expect(add).toHaveBeenCalledTimes(5);
  });

  it('records missing usage without inventing token counts', () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn().mockReturnValue({ add }),
      createHistogram: jest.fn().mockReturnValue({ record: jest.fn() }),
    } as never);

    new GeminiMetrics().usage('gemini-model', 'v2', undefined);

    expect(add).toHaveBeenCalledTimes(1);
  });
});
