import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ok, Result } from 'neverthrow';
import { SystemRole } from 'src/shared/domain/enum';
import { ITokenProvider } from '../domain/repositories/auth.repo.interface';

@Injectable()
export class TokenProvider implements ITokenProvider {
  constructor(private readonly jwtService: JwtService) {}
  async GenerateAccessToken(
    userPublicId: string,
    email: string,
    role: SystemRole,
  ): Promise<Result<string, Error>> {
    const payload = { sub: userPublicId, email, role };
    // secret and expiresIn come from JwtModule.registerAsync in auth.module.ts
    const accessToken = await this.jwtService.signAsync(payload);
    return ok(accessToken);
  }
}
