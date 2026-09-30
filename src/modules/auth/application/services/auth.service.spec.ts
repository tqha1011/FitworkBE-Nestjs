import {
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { ConfigService } from '@nestjs/config';
import { UserType } from 'generated/prisma/enums';
import { err, ok } from 'neverthrow';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonUserRole } from 'src/shared/domain/enum';
import {
  IPasswordHasher,
  IRefreshTokenProvider,
  IRefreshTokenRepository,
} from '../../domain/repositories/auth.repo.interface';
import { AuthService } from './auth.service';

describe('AuthService login span', () => {
  const email = 'private@example.com';
  const password = 'private-password';
  const user = {
    id: 7,
    publicId: 'private-user-id',
    email,
    username: 'applicant',
    fullName: 'Private Applicant',
    passwordHashed: 'private-hash',
    userType: UserType.APPLICANT,
    role: CommonUserRole.ROLE_APPLICANT,
    isActive: true,
  };

  let findByEmail: jest.Mock;
  let verifyPassword: jest.Mock;
  let generateAccessToken: jest.Mock;
  let addRefreshToken: jest.Mock;
  let getTracer: jest.SpyInstance;
  let startActiveSpan: jest.Mock;
  let span: { setAttribute: jest.Mock; setStatus: jest.Mock; end: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    span = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    };
    startActiveSpan = jest.fn(
      (_name: string, callback: (activeSpan: Span) => unknown) =>
        callback(span as unknown as Span),
    );
    getTracer = jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan,
    } as Tracer);

    findByEmail = jest.fn().mockResolvedValue(ok(user));
    verifyPassword = jest.fn().mockResolvedValue(ok(true));
    generateAccessToken = jest
      .fn()
      .mockResolvedValue(ok('private-access-token'));
    addRefreshToken = jest.fn().mockResolvedValue(ok({ publicId: 'token-id' }));

    service = new AuthService(
      { findByEmail } as unknown as IUserRepository,
      { verifyPassword } as unknown as IPasswordHasher,
      { generateAccessToken },
      {
        generate: jest.fn().mockReturnValue({
          rawToken: 'private-refresh-token',
          tokenHash: 'private-token-hash',
        }),
      } as unknown as IRefreshTokenProvider,
      { addRefreshToken } as unknown as IRefreshTokenRepository,
      {
        get: jest.fn((_name: string, fallback: string) => fallback),
      } as unknown as ConfigService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('records a successful login after tokens are issued', async () => {
    const result = await service.loginAsync(email, password);

    expect(result.isOk()).toBe(true);
    expect(getTracer).toHaveBeenCalledWith('fitwork.auth');
    expect(startActiveSpan).toHaveBeenCalledWith(
      'auth.login',
      expect.any(Function),
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.method',
      'password',
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'success',
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('records invalid credentials without verifying a missing user', async () => {
    findByEmail.mockResolvedValue(ok(null));

    const result = await service.loginAsync(email, password);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe(ErrorCode.Unauthorized);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'invalid_credentials',
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('records invalid credentials for a wrong password', async () => {
    verifyPassword.mockResolvedValue(ok(false));

    const result = await service.loginAsync(email, password);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe(ErrorCode.Unauthorized);
    expect(generateAccessToken).not.toHaveBeenCalled();
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'invalid_credentials',
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('records dependency failures without leaking error details into the span', async () => {
    findByEmail.mockResolvedValue(err(new Error(`lookup failed for ${email}`)));

    const result = await service.loginAsync(email, password);

    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.code).toBe(ErrorCode.InternalServerError);
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'internal_error',
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(JSON.stringify(span.setAttribute.mock.calls)).not.toContain(email);
    expect(JSON.stringify(span.setAttribute.mock.calls)).not.toContain(
      password,
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('keeps the span open through token issuance failures', async () => {
    generateAccessToken.mockResolvedValue(err(new Error('signing failed')));

    const result = await service.loginAsync(email, password);

    expect(result.isErr()).toBe(true);
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'internal_error',
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('ends the span and rethrows unexpected exceptions', async () => {
    findByEmail.mockRejectedValue(
      new AppError(ErrorCode.InternalServerError, 'private failure'),
    );

    await expect(service.loginAsync(email, password)).rejects.toThrow(
      'private failure',
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'fitwork.auth.outcome',
      'internal_error',
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});
