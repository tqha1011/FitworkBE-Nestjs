import { AppError, ErrorCode } from './errorCode';
import { toHttpException } from './app-error.mapper';

describe('toHttpException diagnostics', () => {
  it.each(Object.values(ErrorCode))(
    'preserves the application error as cause for %s',
    (code) => {
      const appError = new AppError(code, 'Safe summary');
      const exception = toHttpException(appError);
      expect(exception.cause).toBe(appError);
      expect(JSON.stringify(exception.getResponse())).not.toContain('cause');
    },
  );
});
