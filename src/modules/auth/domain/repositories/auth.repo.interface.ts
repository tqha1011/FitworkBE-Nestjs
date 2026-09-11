import { Result } from 'neverthrow';
import { CommonUserRole } from 'src/shared/domain/enum';

export abstract class IPasswordHasher {
  abstract generateHashPassword(
    password: string,
  ): Promise<Result<string, Error>>;

  abstract verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<Result<boolean, Error>>;
}

export abstract class ITokenProvider {
  abstract generateAccessToken(
    userPublicId: string,
    email: string,
    role: CommonUserRole,
  ): Promise<Result<string, Error>>;
}

export type RefreshTokenRecord = {
  publicId: string;
  userId: number;
  revokedAt: Date | null;
  expiresAt: Date;
};

export abstract class IRefreshTokenRepository {
  abstract addRefreshToken(refreshToken: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<Result<{ publicId: string }, Error>>;

  /**
   * Unfiltered lookup — returns the row regardless of revoked/expired state
   * so the caller can tell "already revoked" (replay/theft signal) apart
   * from "never existed" (bad token).
   */
  abstract getRefreshTokenByHash(
    tokenHash: string,
  ): Promise<Result<RefreshTokenRecord | null, Error>>;

  abstract revokeRefreshToken(publicId: string): Promise<Result<void, Error>>;

  abstract revokeAllRefreshTokensForUser(
    userId: number,
  ): Promise<Result<void, Error>>;
}

export abstract class IRefreshTokenProvider {
  /**
   * Returns the raw token (sent to the client, never persisted) and its
   * SHA-256 hash (persisted).
   */
  abstract generate(): { rawToken: string; tokenHash: string };
  abstract hash(rawToken: string): string;
}
