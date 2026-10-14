import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { QueueName } from './constant/queue-name';
import { QueueConnectionService } from './queue-connection.service';

@Module({
  imports: [ConfigModule],
  providers: [QueueConnectionService],
  exports: [QueueConnectionService],
})
class QueueConnectionModule {}
import { QueueSnapshotService } from './queue-snapshot.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [QueueConnectionModule],
      inject: [QueueConnectionService],
      useFactory: (connection: QueueConnectionService) => ({
        connection: connection.client,
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
