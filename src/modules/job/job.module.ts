import { Module } from '@nestjs/common';
import { IJobRepository } from './domain/repositories/job.repo.interface';
import { JobRepository } from './infrastructure/job.repo';

@Module({
  controllers: [],
  providers: [
    {
      provide: IJobRepository,
      useClass: JobRepository,
    },
  ],
  exports: [IJobRepository],
})
export class JobModule {}
