import { Module } from '@nestjs/common';
import { JobModule } from '../job/job.module';
import { ResumeModule } from '../resume/resume.module';
import { ApplicantEvaluationController } from './api/applicant-evaluation.controller';
import { IApplicantEvaluationService } from './application/interfaces/applicant-evaluation.service.interface';
import { IApplicantEvaluationQueueInterface } from './application/interfaces/applicant-evaluation.queue.interface';
import { ApplicantEvaluationService } from './application/services/applicant-evaluation.service';
import { IApplicantEvaluationRepository } from './domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationQueue } from './infrastructure/applicant-evaluation.queue';
import { ApplicantEvaluationRepository } from './infrastructure/applicant-evaluation.repo';

@Module({
  imports: [JobModule, ResumeModule],
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
  ],
  exports: [IApplicantEvaluationService],
})
export class ApplicantEvaluationModule {}
