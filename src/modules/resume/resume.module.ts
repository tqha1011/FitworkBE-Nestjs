import { Module } from '@nestjs/common';
import { IResumeRepository } from './domain/repositories/resume.repo.interface';
import { ResumeRepository } from './infrastructure/resume.repo';

@Module({
  controllers: [],
  providers: [{ provide: IResumeRepository, useClass: ResumeRepository }],
  exports: [IResumeRepository],
})
export class ResumeModule {}
