import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueName } from './constant/queue-name';

function connectionFromUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  const database = url.pathname.slice(1);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database ? Number(database) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: connectionFromUrl(
          configService.getOrThrow<string>('REDIS_URL'),
        ),
      }),
    }),

    BullModule.registerQueue({
      name: QueueName.ResumeIngestion,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
