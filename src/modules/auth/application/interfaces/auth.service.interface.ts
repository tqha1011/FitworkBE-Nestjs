import { Result } from 'neverthrow';
import { UserType } from 'generated/prisma/enums';
import { AppError } from 'src/shared/common/errorCode';

export type AuthTokens = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export abstract class IAuthService {
  abstract Register(data: {
    email: string;
    username: string;
    fullName: string;
    password: string;
    userType: UserType;
  }): Promise<Result<{ publicId: string }, AppError>>;

  abstract Login(
    email: string,
    password: string,
  ): Promise<Result<AuthTokens, AppError>>;

  abstract RefreshTokens(
    rawRefreshToken: string,
  ): Promise<Result<AuthTokens, AppError>>;

  abstract Logout(rawRefreshToken: string): Promise<Result<void, AppError>>;
}
