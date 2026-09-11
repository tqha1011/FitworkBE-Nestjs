import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserType } from 'generated/prisma/enums';
import { err, ok, Result } from 'neverthrow';
import { IUsersRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { SystemRole } from 'src/shared/domain/enum';
import {
  IPasswordHasher,
  IRefreshTokenProvider,
  IRefreshTokenRepository,
  ITokenProvider,
} from '../../domain/repositories/auth.repo.interface';
import { AuthTokens, IAuthService } from '../interfaces/auth.service.interface';

@Injectable()
export class AuthService implements IAuthService {
  private readonly accessTokenExpiresIn: number;
  private readonly refreshTokenExpiresInDays: number;

  constructor(
    private readonly usersRepository: IUsersRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenProvider: ITokenProvider,
    private readonly refreshTokenProvider: IRefreshTokenProvider,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly configService: ConfigService,
  ) {
    this.accessTokenExpiresIn = Number(
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN_SECONDS', '900'),
    );
    this.refreshTokenExpiresInDays = Number(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN_DAYS', '30'),
    );
  }

  async Register(data: {
    email: string;
    username: string;
    fullName: string;
    password: string;
    userType: UserType;
  }): Promise<Result<{ publicId: string }, AppError>> {
    const existing = await this.usersRepository.FindByEmail(data.email);
    if (existing.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, existing.error.message),
      );
    }
    if (existing.value) {
      return err(
        new AppError(ErrorCode.Conflict, 'Email is already registered'),
      );
    }

    const hashed = await this.passwordHasher.GenerateHashPassword(
      data.password,
    );
    if (hashed.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, hashed.error.message),
      );
    }

    const created = await this.usersRepository.Create({
      email: data.email,
      username: data.username,
      fullName: data.fullName,
      passwordHashed: hashed.value,
      userType: data.userType,
    });
    if (created.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, created.error.message),
      );
    }

    return ok(created.value);
  }

  async Login(
    email: string,
    password: string,
  ): Promise<Result<AuthTokens, AppError>> {
    const found = await this.usersRepository.FindByEmail(email);
    if (found.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, found.error.message),
      );
    }

    const user = found.value;
    if (!user || !user.isActive) {
      return err(
        new AppError(ErrorCode.Unauthorized, 'Invalid email or password'),
      );
    }

    const verified = await this.passwordHasher.VerifyPassword(
      password,
      user.passwordHashed,
    );
    if (verified.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, verified.error.message),
      );
    }
    if (!verified.value) {
      return err(
        new AppError(ErrorCode.Unauthorized, 'Invalid email or password'),
      );
    }

    return this.issueTokens(user.id, user.publicId, user.email);
  }

  async RefreshTokens(
    rawRefreshToken: string,
  ): Promise<Result<AuthTokens, AppError>> {
    const tokenHash = this.refreshTokenProvider.hash(rawRefreshToken);
    const found =
      await this.refreshTokenRepository.GetRefreshTokenByHash(tokenHash);
    if (found.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, found.error.message),
      );
    }

    const record = found.value;
    if (!record) {
      return err(new AppError(ErrorCode.Unauthorized, 'Invalid refresh token'));
    }

    if (record.revokedAt) {
      // A revoked token being presented again means it was replayed/stolen —
      // kill every session for this user instead of trusting this request.
      await this.refreshTokenRepository.RevokeAllRefreshTokensForUser(
        record.userId,
      );
      return err(
        new AppError(ErrorCode.Unauthorized, 'Refresh token has been revoked'),
      );
    }

    if (record.expiresAt.getTime() < Date.now()) {
      return err(new AppError(ErrorCode.Unauthorized, 'Refresh token expired'));
    }

    const userResult = await this.usersRepository.FindById(record.userId);
    if (userResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, userResult.error.message),
      );
    }
    const user = userResult.value;
    if (!user || !user.isActive) {
      return err(new AppError(ErrorCode.Unauthorized, 'Invalid refresh token'));
    }

    const revoked = await this.refreshTokenRepository.RevokeRefreshToken(
      record.publicId,
    );
    if (revoked.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, revoked.error.message),
      );
    }

    return this.issueTokens(user.id, user.publicId, user.email);
  }

  async Logout(rawRefreshToken: string): Promise<Result<void, AppError>> {
    const tokenHash = this.refreshTokenProvider.hash(rawRefreshToken);
    const found =
      await this.refreshTokenRepository.GetRefreshTokenByHash(tokenHash);
    if (found.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, found.error.message),
      );
    }
    if (!found.value) {
      return ok(undefined);
    }

    const revoked = await this.refreshTokenRepository.RevokeRefreshToken(
      found.value.publicId,
    );
    if (revoked.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, revoked.error.message),
      );
    }
    return ok(undefined);
  }

  private async issueTokens(
    userId: number,
    userPublicId: string,
    email: string,
  ): Promise<Result<AuthTokens, AppError>> {
    const accessToken = await this.tokenProvider.GenerateAccessToken(
      userPublicId,
      email,
      SystemRole.User,
    );
    if (accessToken.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, accessToken.error.message),
      );
    }

    const { rawToken, tokenHash } = this.refreshTokenProvider.generate();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000,
    );
    const added = await this.refreshTokenRepository.AddRefreshToken({
      userId,
      tokenHash,
      expiresAt: refreshTokenExpiresAt,
    });
    if (added.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, added.error.message),
      );
    }

    return ok({
      accessToken: accessToken.value,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
      refreshToken: rawToken,
      refreshTokenExpiresAt,
    });
  }
}
