import { createKeyv } from '@keyv/redis';
import { createCache } from 'cache-manager';
import { ReferenceDataCacheKey } from '../../src/modules/job/application/constants/reference-data-cache.constants';
import { RedisApplicationCache } from '../../src/shared/infrastructure/cache/redis-application-cache';
import { requiredEnv } from './database';
import { request } from './http';
import { readCacheMetrics, waitForCacheMetrics } from './metrics';
import { runSkillsBenchmark } from './cache-workload';

export async function benchmarkSkills(options: {
  apiBaseUrl: string;
  token: string;
  missSamples: number;
  concurrencies: number[];
  warmupMs: number;
  durationMs: number;
  timeoutMs: number;
}) {
  // Same factory, namespace, manager and logical-key adapter as CachingModule.
  const manager = createCache({
    stores: [createKeyv(requiredEnv('REDIS_URL'))],
    ttl: Number(requiredEnv('CACHE_TTL')),
  });
  const cache = new RedisApplicationCache(manager);
  const key = ReferenceDataCacheKey.Skills;
  const url = new URL('/api/skills', options.apiBaseUrl).toString();
  try {
    return await runSkillsBenchmark(options, {
      request: () => request(url, options.token, options.timeoutMs),
      deleteKey: () => cache.delete(key),
      hasKey: async () => (await cache.get(key)) !== undefined,
      readMetrics: readCacheMetrics,
      waitMetrics: waitForCacheMetrics,
    });
  } finally {
    await manager.disconnect();
  }
}
