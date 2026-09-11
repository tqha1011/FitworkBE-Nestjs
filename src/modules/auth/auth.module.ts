import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/modules/users/users.module';
import { AuthController } from './api/auth.controller';
import { AuthService } from './application/services/auth.service';
import { IAuthService } from './application/interfaces/auth.service.interface';
import {
  IPasswordHasher,
  IRefreshTokenProvider,
  IRefreshTokenRepository,
  ITokenProvider,
} from './domain/repositories/auth.repo.interface';
import { PasswordHasher } from './infrastructure/passwordHasher';
import { RefreshTokenProvider } from './infrastructure/refreshToken.provider';
import { RefreshTokenRepository } from './infrastructure/refreshToken.repo';
import { TokenProvider } from './infrastructure/tokenProvider';

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
  controllers: [AuthController],
  providers: [
    { provide: IAuthService, useClass: AuthService },
    { provide: IPasswordHasher, useClass: PasswordHasher },
    { provide: ITokenProvider, useClass: TokenProvider },
    { provide: IRefreshTokenProvider, useClass: RefreshTokenProvider },
    { provide: IRefreshTokenRepository, useClass: RefreshTokenRepository },
  ],
  exports: [],
})
export class AuthModule {}
