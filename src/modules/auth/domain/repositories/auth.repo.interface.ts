import { Result } from 'neverthrow';
import { SystemRole } from 'src/shared/domain/enum';

export abstract class IPasswordHasher {
  abstract GenerateHashPassword(
    password: string,
  ): Promise<Result<string, Error>>;

  abstract VerifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<Result<boolean, Error>>;
}

export abstract class ITokenProvider {
  abstract GenerateAccessToken(
    userPublicId: string,
    email: string,
    role: SystemRole,
  ): Promise<Result<string, Error>>;
}

export type RefreshTokenRecord = {
  publicId: string;
  userId: number;
  revokedAt: Date | null;
  expiresAt: Date;
};

export abstract class IRefreshTokenRepository {
  abstract AddRefreshToken(refreshToken: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<Result<{ publicId: string }, Error>>;

  /**
   * Unfiltered lookup — returns the row regardless of revoked/expired state
   * so the caller can tell "already revoked" (replay/theft signal) apart
   * from "never existed" (bad token).
   */
  abstract GetRefreshTokenByHash(
    tokenHash: string,
  ): Promise<Result<RefreshTokenRecord | null, Error>>;

  abstract RevokeRefreshToken(publicId: string): Promise<Result<void, Error>>;

  abstract RevokeAllRefreshTokensForUser(
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
