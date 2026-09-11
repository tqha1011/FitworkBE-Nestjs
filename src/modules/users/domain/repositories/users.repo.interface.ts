import { Result } from 'neverthrow';
import { UserType } from 'generated/prisma/enums';

export type UserRecord = {
  id: number;
  publicId: string;
  email: string;
  username: string;
  fullName: string;
  passwordHashed: string;
  userType: UserType;
  isActive: boolean;
};

export type CreateUserData = {
  email: string;
  username: string;
  fullName: string;
  passwordHashed: string;
  userType: UserType;
};

export abstract class IUsersRepository {
  abstract FindByEmail(
    email: string,
  ): Promise<Result<UserRecord | null, Error>>;

  abstract FindById(id: number): Promise<Result<UserRecord | null, Error>>;

  abstract Create(
    data: CreateUserData,
  ): Promise<Result<{ publicId: string }, Error>>;
}
