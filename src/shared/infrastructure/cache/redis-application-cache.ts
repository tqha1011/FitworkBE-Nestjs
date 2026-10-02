import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { metrics } from '@opentelemetry/api';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';

@Injectable()
export class RedisApplicationCache implements IApplicationCache {
  private readonly meter = metrics.getMeter('fitwork.cache');
  private readonly accesses = this.meter.createCounter(
    'fitwork_cache_accesses_total',
  );
  private readonly dependencyErrors = this.meter.createCounter(
    'fitwork_dependency_errors_total',
  );

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    const cacheGroup = this.cacheGroup(key);
    try {
      const value = await this.cacheManager.get<T>(key);
      this.accesses.add(1, {
        cache_group: cacheGroup,
        result: value === undefined ? 'miss' : 'hit',
      });
      return value;
    } catch (error) {
      this.accesses.add(1, { cache_group: cacheGroup, result: 'error' });
      this.dependencyErrors.add(1, { dependency: 'redis', operation: 'get' });
      throw error;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set<T>(key, value, ttl);
    } catch (error) {
      this.dependencyErrors.add(1, { dependency: 'redis', operation: 'set' });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (error) {
      this.dependencyErrors.add(1, {
        dependency: 'redis',
        operation: 'delete',
      });
      throw error;
    }
  }

  private cacheGroup(key: string): string {
    if (key.startsWith('applicant:')) return 'applicant';
    if (key.startsWith('job-owner:')) return 'job_owner';
    if (key === 'reference-data:skills:v1') return 'reference_skills';
    if (key === 'reference-data:categories:v1') return 'reference_categories';
    if (key === 'reference-data:arrangements:v1')
      return 'reference_arrangements';
    return 'other';
  }
}
