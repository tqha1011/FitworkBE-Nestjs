import { createHmac } from 'crypto';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';

export function demoConfig(get: (key: string) => string | undefined) {
  const limit = (key: string, fallback: number) => {
    const value = Number(get(key) ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    enabled: get('DEMO_ENABLED') === 'true',
    only: (get('DEMO_ONLY') ?? get('DEMO_ENABLED')) === 'true',
    sessionSeconds: limit('DEMO_SESSION_MINUTES', 60) * 60,
    aiPerSession: limit('DEMO_AI_PER_SESSION', 3),
    aiPerDay: limit('DEMO_AI_PER_DAY', 30),
    aiPerIpDay: limit('DEMO_AI_PER_IP_DAY', 6),
    sessionsPerIpHour: limit('DEMO_SESSIONS_PER_IP_HOUR', 3),
    maxActiveSessions: limit('DEMO_MAX_ACTIVE_SESSIONS', 20),
    requestsPerMinute: limit('DEMO_REQUESTS_PER_MINUTE', 60),
    uploadsPerSession: limit('DEMO_UPLOADS_PER_SESSION', 3),
    maxFileBytes: Math.min(
      5 * 1024 * 1024,
      limit('DEMO_MAX_FILE_BYTES', 5 * 1024 * 1024),
    ),
    maxResumeCharacters: Math.min(
      16000,
      limit('DEMO_MAX_RESUME_CHARACTERS', 16000),
    ),
    maxOutputTokens: Math.min(4096, limit('DEMO_MAX_OUTPUT_TOKENS', 4096)),
  };
}

export type DemoIdentity = {
  sub: string;
  role: string;
  demoSessionId?: string;
  demoGeneration?: number;
  demoExpiresAt?: number;
};

export function assertDemoIdentity(
  payload: DemoIdentity,
  session: {
    id: string;
    expiresAt: Date;
    revokedAt: Date | null;
    generation: number;
    activeUserType: string;
    companyUserId: number | null;
    applicantUserId: number | null;
  } | null,
  user: {
    id: number;
    publicId: string;
    demoSessionId: string | null;
    isActive: boolean;
    role: string;
  } | null,
  now = new Date(),
) {
  const activeId =
    session?.activeUserType === 'COMPANY'
      ? session.companyUserId
      : session?.applicantUserId;
  if (
    !session ||
    !user ||
    session.revokedAt ||
    session.expiresAt <= now ||
    !user.isActive ||
    user.id !== activeId ||
    user.publicId !== payload.sub ||
    user.demoSessionId !== session.id ||
    payload.demoSessionId !== session.id ||
    payload.demoGeneration !== session.generation ||
    payload.role !== user.role ||
    payload.demoExpiresAt !== session.expiresAt.getTime()
  ) {
    throw new AppError(ErrorCode.Unauthorized, 'Demo expired — Start new demo');
  }
}

export function hashDemoIp(ip: string, secret: string) {
  return createHmac('sha256', secret)
    .update(ip.replace(/^::ffff:/, ''))
    .digest('hex');
}
