import { Module } from '@nestjs/common';
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
import { IResumeIngestionNotifier } from './application/interfaces/resume-ingestion-notifier.interface';
import { ResumeIngestionEventPublisher } from './infrastructure/resume-ingestion-event.publisher';
import { AuthModule } from '../auth/auth.module';
import { IResumeQueryRepository } from './application/interfaces/resume.query-repo.interface';
import { ResumeQueryRepository } from './infrastructure/resume.query-repo';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [ResumeController],
  providers: [
    ResumeRepository,
    { provide: IResumeRepository, useExisting: ResumeRepository },
    ResumeQueryRepository,
    { provide: IResumeQueryRepository, useExisting: ResumeQueryRepository },
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
    ResumeIngestionEventPublisher,
    {
      provide: IResumeIngestionNotifier,
      useExisting: ResumeIngestionEventPublisher,
    },
    ResumeIngestionService,
    {
      provide: IResumeIngestionService,
      useExisting: ResumeIngestionService,
    },
    ResumeIngestionProcessor,
  ],
  exports: [IResumeRepository, IResumeContentRepository, IResumeService],
})
export class ResumeModule {}
