import * as bcrypt from 'bcrypt';
import { PasswordHasher } from './passwordHasher';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

describe('PasswordHasher error causes', () => {
  it.each([
    new Error('private password payload'),
    { message: 'private password payload' },
  ])(
    'preserves failures without exposing password details (%p)',
    async (failure) => {
      jest.mocked(bcrypt.hash).mockRejectedValue(failure as never);
      jest.mocked(bcrypt.compare).mockRejectedValue(failure as never);
      const hasher = new PasswordHasher();
      for (const result of [
        await hasher.generateHashPassword('password'),
        await hasher.verifyPassword('password', 'hash'),
      ]) {
        const error = result._unsafeUnwrapErr();
        expect(error.cause).toBe(failure);
        expect(error.message).not.toContain('private password payload');
      }
    },
  );
});
