import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserType } from 'generated/prisma/enums';
import { err, ok, Result } from 'neverthrow';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonUserRole } from 'src/shared/domain/enum';
import {
  IPasswordHasher,
  IRefreshTokenProvider,
  IRefreshTokenRepository,
  ITokenProvider,
} from '../../domain/repositories/auth.repo.interface';
import { AuthTokens, IAuthService } from '../interfaces/auth.service.interface';

const userTypeToRole: Record<UserType, CommonUserRole> = {
  COMPANY: CommonUserRole.ROLE_COMPANY,
  APPLICANT: CommonUserRole.ROLE_APPLICANT,
};

@Injectable()
export class AuthService implements IAuthService {
  private readonly accessTokenExpiresIn: number;
  private readonly refreshTokenExpiresInDays: number;

  constructor(
    private readonly userRepository: IUserRepository,
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

  async registerAsync(data: {
    email: string;
    username: string;
    fullName: string;
    password: string;
    userType: UserType;
  }): Promise<Result<{ publicId: string }, AppError>> {
    const existing = await this.userRepository.findByEmail(data.email);
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

    const hashed = await this.passwordHasher.generateHashPassword(
      data.password,
    );
    if (hashed.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, hashed.error.message),
      );
    }

    const created = await this.userRepository.create({
      email: data.email,
      username: data.username,
      fullName: data.fullName,
      passwordHashed: hashed.value,
      userType: data.userType,
      role: userTypeToRole[data.userType],
    });
    if (created.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, created.error.message),
      );
    }

    return ok(created.value);
  }

  async loginAsync(
    email: string,
    password: string,
  ): Promise<Result<AuthTokens, AppError>> {
    const found = await this.userRepository.findByEmail(email);
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

    const verified = await this.passwordHasher.verifyPassword(
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

    return this.issueTokens(user.id, user.publicId, user.email, user.role);
  }

  async refreshTokensAsync(
    rawRefreshToken: string,
  ): Promise<Result<AuthTokens, AppError>> {
    const tokenHash = this.refreshTokenProvider.hash(rawRefreshToken);
    const found =
      await this.refreshTokenRepository.getRefreshTokenByHash(tokenHash);
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
      await this.refreshTokenRepository.revokeAllRefreshTokensForUser(
        record.userId,
      );
      return err(
        new AppError(ErrorCode.Unauthorized, 'Refresh token has been revoked'),
      );
    }

    if (record.expiresAt.getTime() < Date.now()) {
      return err(new AppError(ErrorCode.Unauthorized, 'Refresh token expired'));
    }

    const userResult = await this.userRepository.findById(record.userId);
    if (userResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, userResult.error.message),
      );
    }
    const user = userResult.value;
    if (!user || !user.isActive) {
      return err(new AppError(ErrorCode.Unauthorized, 'Invalid refresh token'));
    }

    const revoked = await this.refreshTokenRepository.revokeRefreshToken(
      record.publicId,
    );
    if (revoked.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, revoked.error.message),
      );
    }

    return this.issueTokens(user.id, user.publicId, user.email, user.role);
  }

  async logoutAsync(rawRefreshToken: string): Promise<Result<void, AppError>> {
    const tokenHash = this.refreshTokenProvider.hash(rawRefreshToken);
    const found =
      await this.refreshTokenRepository.getRefreshTokenByHash(tokenHash);
    if (found.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, found.error.message),
      );
    }
    if (!found.value) {
      return ok(undefined);
    }

    const revoked = await this.refreshTokenRepository.revokeRefreshToken(
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
    role: CommonUserRole,
  ): Promise<Result<AuthTokens, AppError>> {
    const accessToken = await this.tokenProvider.generateAccessToken(
      userPublicId,
      email,
      role,
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
    const added = await this.refreshTokenRepository.addRefreshToken({
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
