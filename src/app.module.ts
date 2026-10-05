import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AllExceptionsFilter } from './shared/common/exceptions.filter';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobModule } from './modules/job/job.module';
import { ResumeModule } from './modules/resume/resume.module';
import { LoggerMiddleware } from './shared/common/logger.middleware';
import { PrismaModule } from './shared/infrastructure/database/prisma.module';
import { QueueModule } from './shared/infrastructure/queue/queue.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ApplicantEvaluationModule } from './modules/applicant-evaluation/applicant-evaluation.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CachingModule } from './shared/infrastructure/cache/cache.module';
import { StructuredLogger } from './shared/observability/structured-logger';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    QueueModule,
    ConfigModule,
    UsersModule,
    AuthModule,
    JobModule,
    ResumeModule,
    RealtimeModule,
    ApplicantEvaluationModule,
    CachingModule,
  ],
  providers: [
    StructuredLogger,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: 'api/*path', method: RequestMethod.ALL });
  }
}
