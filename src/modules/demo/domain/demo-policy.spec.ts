import { assertDemoIdentity, demoConfig, hashDemoIp } from './demo-policy';
import { CommonUserRole } from 'src/shared/domain/enum';

describe('demo identity and limits', () => {
  const now = new Date('2026-10-14T00:00:00Z');
  const session = {
    id: 'session',
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    generation: 2,
    activeUserType: 'COMPANY',
    companyUserId: 1,
    applicantUserId: 2,
  };
  const user = {
    id: 1,
    publicId: 'company',
    demoSessionId: 'session',
    isActive: true,
    role: 'ROLE_COMPANY',
  };
  const payload = {
    sub: 'company',
    email: 'company@test.invalid',
    role: CommonUserRole.ROLE_COMPANY,
    demoSessionId: 'session',
    demoGeneration: 2,
    demoExpiresAt: session.expiresAt.getTime(),
  };
  it('accepts the active primary account', () => {
    expect(() => assertDemoIdentity(payload, session, user, now)).not.toThrow();
  });
  it.each([
    ['expired', { expiresAt: now }, {}],
    ['revoked', { revokedAt: now }, {}],
    ['old role generation', { generation: 3 }, {}],
    ['secondary account', {}, { id: 3 }],
    ['different workspace', {}, { demoSessionId: 'other' }],
    ['disabled account', {}, { isActive: false }],
  ])('rejects %s', (_, sessionChange, userChange) => {
    expect(() =>
      assertDemoIdentity(
        payload,
        { ...session, ...sessionChange },
        { ...user, ...userChange },
        now,
      ),
    ).toThrow();
  });
  it('rejects a forged role and a mismatched expiry', () => {
    expect(() =>
      assertDemoIdentity(
        { ...payload, role: CommonUserRole.ROLE_APPLICANT },
        session,
        user,
        now,
      ),
    ).toThrow();
    expect(() =>
      assertDemoIdentity(
        { ...payload, demoExpiresAt: now.getTime() },
        session,
        user,
        now,
      ),
    ).toThrow();
  });
  it('uses finite positive environment limits', () => {
    const config = demoConfig(
      (key) =>
        ({
          DEMO_ENABLED: 'true',
          DEMO_SESSION_MINUTES: '60',
          DEMO_AI_PER_SESSION: '3',
        })[key],
    );
    expect(config.enabled).toBe(true);
    expect(config.sessionSeconds).toBe(3600);
    expect(config.aiPerSession).toBe(3);
    expect(() => demoConfig(() => 'NaN')).toThrow();
    expect(() => demoConfig(() => '0')).toThrow();
  });
  it('hashes IP with the environment secret and normalizes IPv4 mapped addresses', () => {
    expect(hashDemoIp('::ffff:127.0.0.1', 'secret')).toBe(
      hashDemoIp('127.0.0.1', 'secret'),
    );
    expect(hashDemoIp('127.0.0.1', 'secret')).not.toBe(
      hashDemoIp('127.0.0.1', 'other'),
    );
    expect(hashDemoIp('127.0.0.1', 'secret')).not.toContain('127.0.0.1');
  });
});
