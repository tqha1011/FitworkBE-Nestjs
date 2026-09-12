import { Module } from '@nestjs/common';
import { IJobRepository } from './domain/repositories/job.repo.interface';
import { IJobQueryRepository } from './application/interfaces/job.query-repo.interface';
import { JobRepository } from './infrastructure/job.repo';
import { IJobService } from './application/interfaces/job.service.interface';
import { JobService } from './application/services/job.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [],
  providers: [
    JobRepository,
    { provide: IJobRepository, useExisting: JobRepository },
    { provide: IJobQueryRepository, useExisting: JobRepository },
    { provide: IJobService, useClass: JobService },
  ],
  exports: [IJobRepository, IJobQueryRepository, IJobService],
})
export class JobModule {}
