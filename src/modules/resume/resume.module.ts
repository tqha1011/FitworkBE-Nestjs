import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { ResumeController } from './api/resume.controller';
import { IResumeService } from './application/interfaces/resume.service.interface';
import { ResumeService } from './application/services/resume.service';
import { IResumeRepository } from './domain/repositories/resume.repo.interface';
import { ResumeRepository } from './infrastructure/resume.repo';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { FileStorage } from 'src/shared/infrastructure/storage/file-storage';
import { IResumeContentRepository } from './domain/repositories/resume-content.repo.interface';
import { ResumeContentRepository } from './infrastructure/resume-content.repo';
import { IResumeIngestionQueue } from './application/interfaces/resume-ingestion-queue.interface';
import { ResumeIngestionQueue } from './infrastructure/resume-ingestion.queue';
import { IResumeTextExtractor } from './application/interfaces/resume-text-extractor.interface';
import { ResumeTextExtractor } from './infrastructure/resume-text-extractor';
import { PDFParserService } from 'src/shared/infrastructure/parser/pdf-parser.service';
import { DocxParserService } from 'src/shared/infrastructure/parser/docx-parser.service';
import { IResumeIngestionService } from './application/interfaces/resume-ingestion.service.interface';
import { ResumeIngestionService } from './application/services/resume-ingestion.service';
import { ResumeIngestionProcessor } from './infrastructure/resume-ingestion.processor';
import { ResumeIngestionGateway } from './api/resume-ingestion.gateway';
import { IResumeIngestionNotifier } from './application/interfaces/resume-ingestion-notifier.interface';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: Number(
            configService.get<string>('JWT_ACCESS_EXPIRES_IN_SECONDS', '900'),
          ),
        },
      }),
    }),
  ],
  controllers: [ResumeController],
  providers: [
    ResumeRepository,
    { provide: IResumeRepository, useExisting: ResumeRepository },
    ResumeContentRepository,
    {
      provide: IResumeContentRepository,
      useExisting: ResumeContentRepository,
    },
    { provide: IResumeService, useClass: ResumeService },
    { provide: IFileStorage, useClass: FileStorage },
    ResumeIngestionQueue,
    { provide: IResumeIngestionQueue, useExisting: ResumeIngestionQueue },
    PDFParserService,
    DocxParserService,
    ResumeTextExtractor,
    { provide: IResumeTextExtractor, useExisting: ResumeTextExtractor },
    ResumeIngestionGateway,
    {
      provide: IResumeIngestionNotifier,
      useExisting: ResumeIngestionGateway,
    },
    ResumeIngestionService,
    {
      provide: IResumeIngestionService,
      useExisting: ResumeIngestionService,
    },
    ResumeIngestionProcessor,
  ],
  exports: [IResumeRepository, IResumeService],
})
export class ResumeModule {}
