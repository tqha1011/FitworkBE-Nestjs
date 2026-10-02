import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueName } from './constant/queue-name';
import Redis from 'ioredis';
import { QueueSnapshotService } from './queue-snapshot.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: new Redis(configService.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
      }),
    }),

    BullModule.registerQueue(
      {
        name: QueueName.ResumeIngestion,
      },
      {
        name: QueueName.LlmEvaluation,
      },
    ),
  ],
  providers: [QueueSnapshotService],
  exports: [BullModule],
})
export class QueueModule {}
