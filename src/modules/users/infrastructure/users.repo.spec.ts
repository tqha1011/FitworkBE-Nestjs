import { UsersRepository } from './users.repo';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonUserRole } from 'src/shared/domain/enum';

describe('UsersRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: UsersRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    [
      'checkUserExistsByPublicId',
      (repository) => repository.checkUserExistsByPublicId('user'),
    ],
    [
      'resolvePublicIdToId',
      (repository) => repository.resolvePublicIdToId('user'),
    ],
    ['getUserRole', (repository) => repository.getUserRole('user')],
    [
      'findByEmail',
      (repository) => repository.findByEmail('private@example.com'),
    ],
    ['findById', (repository) => repository.findById(1)],
    [
      'create',
      (repository) =>
        repository.create({
          email: 'private@example.com',
          username: 'user',
          fullName: 'User',
          passwordHashed: 'hash',
          userType: 'APPLICANT',
          role: CommonUserRole.ROLE_APPLICANT,
        }),
    ],
  ];

  describe.each([
    ['Error', new Error('private dependency payload')],
    ['non-Error', { message: 'private dependency payload', code: 'PRIVATE' }],
  ])('%s failures', (_kind, failure) => {
    it.each(operations)(
      'preserves the cause and hides dependency details in %s',
      async (_method, invoke) => {
        const delegate = {
          findUnique: jest.fn().mockRejectedValue(failure),
          findFirst: jest.fn().mockRejectedValue(failure),
          findMany: jest.fn().mockRejectedValue(failure),
          count: jest.fn().mockRejectedValue(failure),
          create: jest.fn().mockRejectedValue(failure),
          update: jest.fn().mockRejectedValue(failure),
          updateMany: jest.fn().mockRejectedValue(failure),
        };
        const repository = new UsersRepository({
          user: delegate,
          resume: delegate,
          $transaction: jest.fn().mockRejectedValue(failure),
        } as unknown as PrismaService);
        const error = (await invoke(repository))._unsafeUnwrapErr();
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain('private dependency payload');
        expect(error.message).not.toContain('[object Object]');
      },
    );
  });
});

jest.mock('src/shared/infrastructure/database/prisma.service', () => ({
  PrismaService: jest.fn(),
}));
