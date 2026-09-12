import { UserRole } from 'generated/prisma/enums';
import { CommonUserRole } from 'src/shared/domain/enum';

const roleToPrisma: Record<CommonUserRole, UserRole> = {
  [CommonUserRole.ROLE_APPLICANT]: UserRole.ROLE_APPLICANT,
  [CommonUserRole.ROLE_COMPANY]: UserRole.ROLE_COMPANY,
};

const roleToDomain: Record<UserRole, CommonUserRole> = {
  [UserRole.ROLE_APPLICANT]: CommonUserRole.ROLE_APPLICANT,
  [UserRole.ROLE_COMPANY]: CommonUserRole.ROLE_COMPANY,
};

export function mapRoleToPrisma(role: CommonUserRole): UserRole {
  return roleToPrisma[role];
}

export function mapRoleToDomain(role: UserRole): CommonUserRole {
  return roleToDomain[role];
}
