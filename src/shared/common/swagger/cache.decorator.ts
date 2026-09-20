import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { applyDecorators, UseInterceptors } from '@nestjs/common';

export function CacheDecorator(ttl: number, key: string) {
  return applyDecorators(
    CacheTTL(ttl),
    CacheKey(key),
    UseInterceptors(CacheInterceptor),
  );
}
