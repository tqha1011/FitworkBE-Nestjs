import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  CreateUserData,
  IUsersRepository,
  UserRecord,
} from '../domain/repositories/users.repo.interface';

@Injectable()
export class UsersRepository implements IUsersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async FindByEmail(email: string): Promise<Result<UserRecord | null, Error>> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { email },
        select: {
          id: true,
          publicId: true,
          email: true,
          username: true,
          fullName: true,
          passwordHashed: true,
          userType: true,
          isActive: true,
        },
      });
      return ok(user);
    } catch (error) {
      return err(new Error(`Failed to find user by email. ${error}`));
    }
  }

  async FindById(id: number): Promise<Result<UserRecord | null, Error>> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id },
        select: {
          id: true,
          publicId: true,
          email: true,
          username: true,
          fullName: true,
          passwordHashed: true,
          userType: true,
          isActive: true,
        },
      });
      return ok(user);
    } catch (error) {
      return err(new Error(`Failed to find user by id. ${error}`));
    }
  }

  async Create(
    data: CreateUserData,
  ): Promise<Result<{ publicId: string }, Error>> {
    try {
      const created = await this.prismaService.user.create({
        data,
        select: { publicId: true },
      });
      return ok(created);
    } catch (error) {
      return err(new Error(`Failed to create user. ${error}`));
    }
  }
}
