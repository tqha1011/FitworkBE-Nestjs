import { Module } from '@nestjs/common';
import { IUserRepository } from './domain/repositories/users.repo.interface';
import { UsersRepository } from './infrastructure/users.repo';

@Module({
  controllers: [],
  providers: [{ provide: IUserRepository, useClass: UsersRepository }],
  exports: [IUserRepository],
})
export class UsersModule {}
