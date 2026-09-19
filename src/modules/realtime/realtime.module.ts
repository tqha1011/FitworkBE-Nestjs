import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { ResumeGateway } from './gateways/resume-gateway';
import { Module } from '@nestjs/common';

@Module({
  imports: [AuthModule, JwtModule],
  providers: [ResumeGateway],
})
export class RealtimeModule {}
