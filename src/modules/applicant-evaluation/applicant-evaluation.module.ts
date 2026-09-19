import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JobModule } from '../job/job.module';
import { ResumeModule } from '../resume/resume.module';
import { ApplicantEvaluationController } from './api/applicant-evaluation.controller';
import { IApplicantEvaluationService } from './application/interfaces/applicant-evaluation.service.interface';
import { IApplicantEvaluationQueueInterface } from './application/interfaces/applicant-evaluation.queue.interface';
import { ApplicantEvaluationService } from './application/services/applicant-evaluation.service';
import { IApplicantEvaluationRepository } from './domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationQueue } from './infrastructure/applicant-evaluation.queue';
import { ApplicantEvaluationRepository } from './infrastructure/applicant-evaluation.repo';
import { IApplicantEvaluationProcessingService } from './application/interfaces/applicant-evaluation-processing.service.interface';
import { ApplicantEvaluationProcessingService } from './application/services/applicant-evaluation.processing.service';
import { IApplicantEvaluationLlm } from './application/interfaces/applicant-evaluation-llm.interface';
import { GeminiEvaluateApplicant } from './infrastructure/llm/providers/applicant-evaluation-gemini';
import { IApplicantEvaluationNotifier } from './application/interfaces/applicant-evaluation-notifier.interface';
import { ApplicantEvaluationEventPublisher } from './infrastructure/applicant-evaluation-event.publisher';
import { ApplicantEvaluationProcessor } from './infrastructure/applicant-evaluation.processor';

@Module({
  imports: [
    JobModule,
    ResumeModule,
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
  controllers: [ApplicantEvaluationController],
  providers: [
    ApplicantEvaluationRepository,
    {
      provide: IApplicantEvaluationRepository,
      useExisting: ApplicantEvaluationRepository,
    },
    ApplicantEvaluationQueue,
    {
      provide: IApplicantEvaluationQueueInterface,
      useExisting: ApplicantEvaluationQueue,
    },
    ApplicantEvaluationService,
    {
      provide: IApplicantEvaluationService,
      useExisting: ApplicantEvaluationService,
    },
    GeminiEvaluateApplicant,
    {
      provide: IApplicantEvaluationLlm,
      useExisting: GeminiEvaluateApplicant,
    },
    ApplicantEvaluationEventPublisher,
    {
      provide: IApplicantEvaluationNotifier,
      useExisting: ApplicantEvaluationEventPublisher,
    },
    ApplicantEvaluationProcessingService,
    {
      provide: IApplicantEvaluationProcessingService,
      useExisting: ApplicantEvaluationProcessingService,
    },
    ApplicantEvaluationProcessor,
  ],
  exports: [IApplicantEvaluationService, IApplicantEvaluationRepository],
})
export class ApplicantEvaluationModule {}
