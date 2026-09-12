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
  abstract registerAsync(data: {
    email: string;
    username: string;
    fullName: string;
    password: string;
    userType: UserType;
  }): Promise<Result<{ publicId: string }, AppError>>;

  abstract loginAsync(
    email: string,
    password: string,
  ): Promise<Result<AuthTokens, AppError>>;

  abstract refreshTokensAsync(
    rawRefreshToken: string,
  ): Promise<Result<AuthTokens, AppError>>;

  abstract logoutAsync(
    rawRefreshToken: string,
  ): Promise<Result<void, AppError>>;
}
