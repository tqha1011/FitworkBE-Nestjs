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
    { provide: IResumeRepository, useClass: ResumeRepository },
    { provide: IResumeService, useClass: ResumeService },
    { provide: IFileStorage, useClass: FileStorage },
  ],
  exports: [IResumeRepository, IResumeService],
})
export class ResumeModule {}
