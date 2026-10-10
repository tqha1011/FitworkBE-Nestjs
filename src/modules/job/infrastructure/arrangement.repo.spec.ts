import { ArrangementRepository } from './arrangement.repo';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';

describe('ArrangementRepository error causes', () => {
  const operations: Array<
    [
      string,
      (
        repository: ArrangementRepository,
      ) => Promise<import('neverthrow').Result<unknown, Error>>,
    ]
  > = [
    ['getAllArrangements', (repository) => repository.getAllArrangements()],
    ['arrangementExists', (repository) => repository.arrangementExists(1)],
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
        const repository = new ArrangementRepository({
          arrangement: delegate,
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
