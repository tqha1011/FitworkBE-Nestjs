import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Result, err, ok } from 'neverthrow';
import { IPasswordHasher } from '../domain/repositories/auth.repo.interface';

@Injectable()
export class PasswordHasher implements IPasswordHasher {
  async generateHashPassword(password: string): Promise<Result<string, Error>> {
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      return ok(passwordHash);
    } catch (error) {
      return err(new Error(`Error generating password hash. Error: ${error}`));
    }
  }
  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const isMatch = await bcrypt.compare(password, hashedPassword);
      return ok(isMatch);
    } catch (error) {
      return err(new Error(`Error verifying password. Error: ${error}`));
    }
  }
}
