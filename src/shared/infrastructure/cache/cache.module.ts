import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        stores: createKeyv(configService.getOrThrow<string>('REDIS_URL')),
        ttl: Number(configService.getOrThrow<string>('CACHE_TTL')),
      }),
    }),
  ],
  exports: [CacheModule],
})
export class CachingModule {}
