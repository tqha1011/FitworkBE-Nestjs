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
  ],
  exports: [IJobRepository, IJobQueryRepository, IJobService],
})
export class JobModule {}
