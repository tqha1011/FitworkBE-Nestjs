import { Prisma } from 'generated/prisma/client';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { DemoLimits } from '../domain/demo.repo.interface';

// Transaction-scoped lock: a small demo deployment serializes budget/lifecycle mutations.
// The lock order is identical for create, refresh, switch, quota and cleanup.
export async function lockDemo(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(726413, 1)`;
}

export async function consumeDemoUsage(
  tx: Prisma.TransactionClient,
  key: string,
  limit: number,
  expiresAt: Date,
) {
  const usage = await tx.demoUsage.findUnique({ where: { key } });
  if ((usage?.count ?? 0) >= limit)
    throw new AppError(ErrorCode.TooManyRequests, 'Demo usage limit reached');
  await tx.demoUsage.upsert({
    where: { key },
    create: { key, count: 1, expiresAt },
    update: { count: { increment: 1 } },
  });
}

export async function consumeDemoAi(
  tx: Prisma.TransactionClient,
  sessionId: string,
  limits: DemoLimits,
) {
  const session = await tx.demoSession.findUnique({ where: { id: sessionId } });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now)
    throw new AppError(ErrorCode.Unauthorized, 'Demo expired — Start new demo');
  if (session.aiRuns >= limits.aiPerSession)
    throw new AppError(
      ErrorCode.TooManyRequests,
      'Demo AI session limit reached',
    );
  const day = now.toISOString().slice(0, 10);
  const expiresAt = new Date(`${day}T00:00:00.000Z`);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
  await consumeDemoUsage(tx, `ai:global:${day}`, limits.aiPerDay, expiresAt);
  await consumeDemoUsage(
    tx,
    `ai:ip:${session.ipHash}:${day}`,
    limits.aiPerIpDay,
    expiresAt,
  );
  await tx.demoSession.update({
    where: { id: session.id },
    data: { aiRuns: { increment: 1 } },
  });
}
