import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';

@Injectable()
export class RedisApplicationCache implements IApplicationCache {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  get<T>(key: string): Promise<T | undefined> {
    return this.cacheManager.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheManager.set<T>(key, value, ttl);
  }

  async delete(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }
}
