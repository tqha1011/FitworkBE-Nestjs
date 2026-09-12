import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { IRefreshTokenProvider } from '../domain/repositories/auth.repo.interface';

@Injectable()
export class RefreshTokenProvider implements IRefreshTokenProvider {
  generate(): { rawToken: string; tokenHash: string } {
    const rawToken = randomBytes(32).toString('hex');
    return { rawToken, tokenHash: this.hash(rawToken) };
  }

  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
