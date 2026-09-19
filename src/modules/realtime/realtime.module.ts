import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ResumeModule } from '../resume/resume.module';
import { ResumeGateway } from './gateways/resume-gateway';
import { ApplicantEvaluationModule } from '../applicant-evaluation/applicant-evaluation.module';
import { ApplicantEvaluationGateway } from './gateways/applicant-evaluation-gateway';

@Module({
  imports: [
    ResumeModule,
    ApplicantEvaluationModule,
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
  providers: [ResumeGateway, ApplicantEvaluationGateway],
})
export class RealtimeModule {}
