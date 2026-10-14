import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { FileStorage } from 'src/shared/infrastructure/storage/file-storage';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { IDemoRepository, IDemoCleanup } from './domain/demo.repo.interface';
import { DemoRepository } from './infrastructure/demo.repo';
import { DemoCleanup } from './infrastructure/demo-cleanup';
import { DemoAccessService } from './application/demo-access.service';
import { DemoService } from './application/demo.service';
import {
  DemoAuthController,
  DemoController,
  DemoEnabledGuard,
  DemoOrdinaryAuthGuard,
} from './api/demo.controller';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [DemoAuthController, DemoController],
  providers: [
    { provide: IDemoRepository, useClass: DemoRepository },
    { provide: IFileStorage, useClass: FileStorage },
    { provide: IDemoCleanup, useClass: DemoCleanup },
    DemoAccessService,
    DemoService,
    DemoEnabledGuard,
    DemoOrdinaryAuthGuard,
  ],
  exports: [
    IDemoRepository,
    DemoAccessService,
    DemoService,
    DemoEnabledGuard,
    DemoOrdinaryAuthGuard,
  ],
})
export class DemoModule {}
