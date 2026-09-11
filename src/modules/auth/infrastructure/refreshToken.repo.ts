import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../domain/repositories/auth.repo.interface';

@Injectable()
export class RefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async addRefreshToken(refreshToken: {
    userId: number;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<Result<{ publicId: string }, Error>> {
    try {
      const created = await this.prismaService.refreshToken.create({
        data: {
          userId: refreshToken.userId,
          tokenHash: refreshToken.tokenHash,
          expiresAt: refreshToken.expiresAt,
        },
        select: { publicId: true },
      });
      return ok(created);
    } catch (error) {
      return err(new Error(`Failed to add refresh token. ${error}`));
    }
  }

  async getRefreshTokenByHash(
    tokenHash: string,
  ): Promise<Result<RefreshTokenRecord | null, Error>> {
    try {
      const record = await this.prismaService.refreshToken.findUnique({
        where: { tokenHash },
        select: {
          publicId: true,
          userId: true,
          revokedAt: true,
          expiresAt: true,
        },
      });
      return ok(record);
    } catch (error) {
      return err(new Error(`Failed to get refresh token by hash. ${error}`));
    }
  }

  async revokeRefreshToken(publicId: string): Promise<Result<void, Error>> {
    try {
      await this.prismaService.refreshToken.update({
        where: { publicId },
        data: { revokedAt: new Date() },
      });
      return ok(undefined);
    } catch (error) {
      return err(new Error(`Failed to revoke refresh token. ${error}`));
    }
  }

  async revokeAllRefreshTokensForUser(
    userId: number,
  ): Promise<Result<void, Error>> {
    try {
      await this.prismaService.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return ok(undefined);
    } catch (error) {
      return err(
        new Error(`Failed to revoke refresh tokens for user. ${error}`),
      );
    }
  }
}
