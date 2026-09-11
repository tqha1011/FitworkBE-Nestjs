import { Module } from '@nestjs/common';
import { IUsersRepository } from './domain/repositories/users.repo.interface';
import { UsersRepository } from './infrastructure/users.repo';

@Module({
  controllers: [],
  providers: [{ provide: IUsersRepository, useClass: UsersRepository }],
  exports: [IUsersRepository],
})
export class UsersModule {}
