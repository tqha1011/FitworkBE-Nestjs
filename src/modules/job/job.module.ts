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
  controllers: [JobController],
  providers: [
    JobRepository,
    { provide: IJobRepository, useExisting: JobRepository },
    { provide: IJobQueryRepository, useExisting: JobRepository },
    { provide: IJobService, useClass: JobService },
    { provide: IJobApplicantRepository, useClass: JobApplicantRepository },
    { provide: IJobApplicantService, useClass: JobApplicantService },
  ],
  exports: [
    IJobRepository,
    IJobQueryRepository,
    IJobService,
    IJobApplicantService,
    IJobApplicantRepository,
  ],
})
export class JobModule {}
