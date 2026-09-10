import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UserResponseDto } from '../dtos/user.response';

@Injectable()
export class UsersService {
  private readonly users = new Map<string, UserResponseDto>();

  create(dto: CreateUserDto): UserResponseDto {
    const user: UserResponseDto = {
      id: randomUUID(),
      email: dto.email,
      name: dto.name,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): UserResponseDto {
    const user = this.users.get(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
