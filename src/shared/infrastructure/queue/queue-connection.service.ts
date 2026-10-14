import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** BullMQ does not close a caller-owned Redis connection. */
@Injectable()
export class QueueConnectionService implements OnApplicationShutdown {
  readonly client: Redis;
  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: null,
    });
  }
  async onApplicationShutdown() {
    if (this.client.status !== 'end') await this.client.quit();
  }
}
