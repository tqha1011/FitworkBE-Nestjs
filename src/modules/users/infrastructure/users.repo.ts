import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  CreateUserData,
  IUserRepository,
  UserRecord,
} from '../domain/repositories/users.repo.interface';
import { CommonUserRole } from 'src/shared/domain/enum';
import { mapRoleToDomain, mapRoleToPrisma } from './user.mapper';

@Injectable()
export class UsersRepository implements IUserRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { publicId },
        select: {
          id: true,
        },
      });
      if (!user) {
        return ok(null);
      }
      return ok(user.id);
    } catch (error) {
      return err(new Error(`Failed to resolve public id to id. ${error}`));
    }
  }
  async getUserRole(
    userPublicId: string,
  ): Promise<Result<CommonUserRole, Error>> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { publicId: userPublicId },
        select: {
          role: true,
        },
      });
      if (!user) {
        return err(new Error(`User not found.`));
      }
      return ok(mapRoleToDomain(user.role));
    } catch (error) {
      return err(new Error(`Failed to get user role. ${error}`));
    }
  }

  async findByEmail(email: string): Promise<Result<UserRecord | null, Error>> {
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
          role: true,
          isActive: true,
        },
      });
      if (!user) {
        return ok(null);
      }
      const response: UserRecord = {
        ...user,
        role: mapRoleToDomain(user.role),
      };
      return ok(response);
    } catch (error) {
      return err(new Error(`Failed to find user by email. ${error}`));
    }
  }

  async findById(id: number): Promise<Result<UserRecord | null, Error>> {
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
          role: true,
          isActive: true,
        },
      });
      if (!user) {
        return ok(null);
      }
      const response: UserRecord = {
        ...user,
        role: mapRoleToDomain(user.role),
      };
      return ok(response);
    } catch (error) {
      return err(new Error(`Failed to find user by id. ${error}`));
    }
  }

  async create(
    data: CreateUserData,
  ): Promise<Result<{ publicId: string }, Error>> {
    try {
      const created = await this.prismaService.user.create({
        data: { ...data, role: mapRoleToPrisma(data.role) },
        select: { publicId: true },
      });
      return ok(created);
    } catch (error) {
      return err(new Error(`Failed to create user. ${error}`));
    }
  }
}
