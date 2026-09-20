import { Injectable, Inject } from '@nestjs/common';
import { IApplicationCache } from './application-cache.interface';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class ApplicationCache implements IApplicationCache {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}
  async get<T>(key: string): Promise<T | undefined> {
    return await this.cacheManager.get<T>(key);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheManager.set<T>(key, value, ttl);
  }

  async delete(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }
}
