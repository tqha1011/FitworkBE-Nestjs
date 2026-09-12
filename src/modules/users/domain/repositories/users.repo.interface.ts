import { Result } from 'neverthrow';
import { UserType } from 'generated/prisma/enums';
import { CommonUserRole } from 'src/shared/domain/enum';

export type UserRecord = {
  id: number;
  publicId: string;
  email: string;
  username: string;
  fullName: string;
  passwordHashed: string;
  userType: UserType;
  role: CommonUserRole;
  isActive: boolean;
};

export type CreateUserData = {
  email: string;
  username: string;
  fullName: string;
  passwordHashed: string;
  userType: UserType;
  role: CommonUserRole;
};

export abstract class IUserRepository {
  abstract findByEmail(
    email: string,
  ): Promise<Result<UserRecord | null, Error>>;

  abstract findById(id: number): Promise<Result<UserRecord | null, Error>>;

  abstract create(
    data: CreateUserData,
  ): Promise<Result<{ publicId: string }, Error>>;

  abstract getUserRole(
    userPublicId: string,
  ): Promise<Result<CommonUserRole, Error>>;

  abstract resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;
}
