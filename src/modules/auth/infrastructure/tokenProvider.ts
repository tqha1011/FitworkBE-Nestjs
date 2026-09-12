import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ok, Result } from 'neverthrow';
import { CommonUserRole } from 'src/shared/domain/enum';
import { ITokenProvider } from '../domain/repositories/auth.repo.interface';
import { IUserRepository } from '../../users/domain/repositories/users.repo.interface';
@Injectable()
export class TokenProvider implements ITokenProvider {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersRepository: IUserRepository,
  ) {}
  async generateAccessToken(
    userPublicId: string,
    email: string,
    role: CommonUserRole,
  ): Promise<Result<string, Error>> {
    const payload = { sub: userPublicId, email, role };
    // secret and expiresIn come from JwtModule.registerAsync in auth.module.ts
    const accessToken = await this.jwtService.signAsync(payload);
    return ok(accessToken);
  }
}
