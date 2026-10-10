import { performance } from 'node:perf_hooks';

export class TokenError extends Error {}
export function assertTokenLifetime(
  token: string,
  minimumRemainingMs = 0,
): void {
  // Decode only for a clear expiration message; the API verifies the signature.
  const part = token.split('.')[1];
  if (!part) return;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown;
  } catch {
    return;
  }
  if (
    typeof claims !== 'object' ||
    claims === null ||
    !('exp' in claims) ||
    typeof claims.exp !== 'number'
  )
    return;
  const remaining = claims.exp * 1000 - Date.now();
  if (remaining <= 0)
    throw new TokenError(
      'Access token expired; provide a fresh ACCESS_TOKEN and rerun.',
    );
  if (remaining < minimumRemainingMs)
    throw new TokenError(
      `Access token expires before the full benchmark (need at least ${Math.ceil(minimumRemainingMs / 1000)} seconds remaining). Set JWT_ACCESS_EXPIRES_IN_SECONDS=3600 on the development API, log in again and provide its ACCESS_TOKEN.`,
    );
}
export type ResponseSample = {
  status: number;
  latencyMs: number;
  timeout: boolean;
  transportError?: string;
  body?: unknown;
};

export async function request(
  url: string,
  token: string,
  timeout: number,
): Promise<ResponseSample> {
  assertTokenLifetime(token);
  const start = performance.now();
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    const latencyMs = performance.now() - start;
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
    return { status: response.status, latencyMs, timeout: false, body };
  } catch (error: unknown) {
    const timedOut =
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      ['TimeoutError', 'AbortError'].includes(String(error.name));
    return {
      status: 0,
      latencyMs: performance.now() - start,
      timeout: timedOut,
      transportError: timedOut
        ? undefined
        : error instanceof Error
          ? error.message
          : 'Transport error',
    };
  }
}

export async function runCase(
  task: () => Promise<ResponseSample>,
  options: { concurrency: number; warmupMs: number; durationMs: number },
) {
  const latencies: number[] = [];
  const errorsByStatus: Record<string, number> = {};
  let timeouts = 0;
  let transportErrors = 0;
  let requests = 0;
  let authError: string | undefined;
  let taskError: string | undefined;
  const phase = async (duration: number, measured: boolean) => {
    const start = performance.now();
    const until = start + duration;
    await Promise.all(
      Array.from({ length: options.concurrency }, async () => {
        while (performance.now() < until && !authError && !taskError) {
          let sample: ResponseSample;
          try {
            sample = await task();
          } catch (error: unknown) {
            if (error instanceof TokenError) {
              authError = error.message;
              break;
            }
            taskError =
              error instanceof Error ? error.message : 'Benchmark task failed';
            break;
          }
          if (sample.status === 401 || sample.status === 403)
            authError = `HTTP ${sample.status}: access token expired, invalid or unauthorized; provide a valid ACCESS_TOKEN.`;
          if (!measured) continue;
          requests++;
          if (sample.timeout) timeouts++;
          else if (sample.status === 0) transportErrors++;
          else if (sample.status >= 200 && sample.status < 300)
            latencies.push(sample.latencyMs);
          else
            errorsByStatus[sample.status] =
              (errorsByStatus[sample.status] ?? 0) + 1;
        }
      }),
    );
    return performance.now() - start;
  };
  await phase(options.warmupMs, false);
  const elapsedMs =
    authError || taskError ? 0 : await phase(options.durationMs, true);
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) =>
    latencies.length
      ? latencies[Math.max(0, Math.ceil(p * latencies.length) - 1)]
      : null;
  return {
    concurrency: options.concurrency,
    warmupMs: options.warmupMs,
    targetDurationMs: options.durationMs,
    elapsedMs,
    requests,
    successful: latencies.length,
    throughputRps: elapsedMs ? latencies.length / (elapsedMs / 1000) : 0,
    requestRps: elapsedMs ? requests / (elapsedMs / 1000) : 0,
    timeouts,
    transportErrors,
    errorsByStatus,
    authError,
    error: taskError,
    latency: {
      samples: latencies.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
    },
  };
}
export type CaseResult = Awaited<ReturnType<typeof runCase>>;
