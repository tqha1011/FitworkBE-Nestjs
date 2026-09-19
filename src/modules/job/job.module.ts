import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { IJobRepository } from './domain/repositories/job.repo.interface';
import { IJobQueryRepository } from './application/interfaces/job.query-repo.interface';
import { JobRepository } from './infrastructure/job.repo';
import { IJobService } from './application/interfaces/job.service.interface';
import { JobService } from './application/services/job.service';
import { UsersModule } from '../users/users.module';
import { JobController } from './api/job.controller';
import { IJobApplicantRepository } from './domain/repositories/job-applicant.repo.interface';
import { JobApplicantRepository } from './infrastructure/job-applicant.repo';
import { IJobApplicantService } from './application/interfaces/job-applicant.service.interface';
import { JobApplicantService } from './application/services/job-applicant.service';
import { ISkillRepository } from './domain/repositories/skill.repo.interface';
import { SkillRepository } from './infrastructure/skill.repo';
import { ICategoryRepository } from './domain/repositories/category.repo.interface';
import { CategoryRepository } from './infrastructure/category.repo';
import { IArrangementRepository } from './domain/repositories/arrangement.repo.interface';
import { ArrangementRepository } from './infrastructure/arrangement.repo';
import { ICategoryService } from './application/interfaces/category.service.interface';
import { CategoryService } from './application/services/category.service';
import { IArrangementService } from './application/interfaces/arrangement.service.interface';
import { ArrangementService } from './application/services/arrangement.service';
import { ArrangementController } from './api/arrangment.controller';
import { CategoryController } from './api/category.controller';
import { ResumeModule } from '../resume/resume.module';
import { IJobApplicantQueryRepo } from './application/interfaces/job-applicant.query-repo.interface';

@Module({
  imports: [
    UsersModule,
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
  controllers: [JobController, ArrangementController, CategoryController],
  providers: [
    JobRepository,
    { provide: IJobRepository, useExisting: JobRepository },
    { provide: IJobQueryRepository, useExisting: JobRepository },
    { provide: IJobApplicantQueryRepo, useExisting: JobRepository },
    { provide: IJobService, useClass: JobService },
    { provide: IJobApplicantRepository, useClass: JobApplicantRepository },
    { provide: IJobApplicantService, useClass: JobApplicantService },
    { provide: ISkillRepository, useClass: SkillRepository },
    { provide: ICategoryRepository, useClass: CategoryRepository },
    { provide: IArrangementRepository, useClass: ArrangementRepository },
    { provide: ICategoryService, useClass: CategoryService },
    { provide: IArrangementService, useClass: ArrangementService },
  ],
  exports: [
    IJobRepository,
    IJobQueryRepository,
    IJobApplicantQueryRepo,
    IJobService,
    IJobApplicantService,
    IJobApplicantRepository,
    ISkillRepository,
    ICategoryRepository,
    IArrangementRepository,
    ICategoryService,
    IArrangementService,
  ],
})
export class JobModule {}
