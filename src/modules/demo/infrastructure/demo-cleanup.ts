import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { QueueName } from 'src/shared/infrastructure/queue/constant/queue-name';
import { lockDemo } from './demo-transaction';
import { demoMetrics } from '../domain/demo-metrics';

@Injectable()
export class DemoCleanup {
  private readonly logger = new Logger(DemoCleanup.name);
  constructor(
    private readonly db: PrismaService,
    private readonly storage: IFileStorage,
    @InjectQueue(QueueName.LlmEvaluation)
    private readonly evaluationQueue: Queue,
    @InjectQueue(QueueName.ResumeIngestion) private readonly resumeQueue: Queue,
  ) {}
  async run() {
    // A separate try-lock prevents overlapping cleaners; never hold a connection lock.
    await this.db.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<
          Array<{ locked: boolean }>
        >`SELECT pg_try_advisory_xact_lock(726413, 2) AS locked`;
        if (!lock[0]?.locked) return;
        await lockDemo(tx);
        const sessions = await tx.demoSession.findMany({
          where: {
            cleanupStatus: 'PENDING',
            OR: [
              { expiresAt: { lte: new Date() } },
              { revokedAt: { not: null } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });
        for (const session of sessions) {
          await tx.demoSession.update({
            where: { id: session.id },
            data: {
              revokedAt: session.revokedAt ?? new Date(),
              cleanupStatus: 'WAITING',
            },
          });
          await tx.user.updateMany({
            where: { demoSessionId: session.id },
            data: { isActive: false },
          });
          await tx.refreshToken.updateMany({
            where: { user: { demoSessionId: session.id }, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        // Revoke is committed before touching queues or storage.
      },
      { timeout: 30000 },
    );
    const sessions = await this.db.demoSession.findMany({
      where: {
        revokedAt: { not: null },
        cleanupStatus: { in: ['WAITING', 'FAILED'] },
      },
      take: 20,
      orderBy: [{ cleanupAttempts: 'asc' }, { createdAt: 'asc' }],
    });
    for (const session of sessions) {
      const owner = randomUUID();
      const claimed = await this.db.demoSession.updateMany({
        where: {
          id: session.id,
          cleanupStatus: { not: 'DONE' },
          OR: [
            { cleanupLeaseUntil: null },
            { cleanupLeaseUntil: { lte: new Date() } },
          ],
        },
        data: {
          cleanupOwner: owner,
          cleanupLeaseUntil: new Date(Date.now() + 120000),
          cleanupAttempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      try {
        const uploads = await this.db.demoUpload.findMany({
          where: { sessionId: session.id },
        });
        if (uploads.some((u) => u.expiresAt > new Date())) continue;
        const resumes = await this.db.resume.findMany({
          where: { user: { demoSessionId: session.id } },
          include: { contents: true },
        });
        const evaluations = await this.db.applicantEvaluation.findMany({
          where: { jobApplicant: { applicant: { demoSessionId: session.id } } },
          select: { publicId: true },
        });
        let active = false;
        const queueJobs = [
          ...evaluations.map((e) => ({
            queue: this.evaluationQueue,
            id: e.publicId,
          })),
          ...resumes.flatMap((r) =>
            r.contents.map((c) => ({
              queue: this.resumeQueue,
              id: c.publicId,
            })),
          ),
        ];
        for (const reference of queueJobs) {
          const job = await reference.queue.getJob(reference.id);
          if (!job) continue;
          if ((await job.getState()) === 'active') {
            active = true;
            continue;
          }
          try {
            await job.remove();
          } catch {
            active = true;
          }
        }
        if (active) continue;
        const keys = new Set([
          ...uploads.map((u) => u.key),
          ...resumes.flatMap((r) => [
            r.storagePath,
            ...r.contents.map((c) => c.storagePath),
          ]),
        ]);
        const users = await this.db.user.findMany({
          where: { demoSessionId: session.id },
          select: { publicId: true },
        });
        for (const key of keys) {
          // Shared sample assets and foreign objects can never be deleted here.
          if (!users.some((user) => key.startsWith(`user/${user.publicId}/`)))
            continue;
          const removed = await this.storage.deleteObject(key);
          if (removed.isErr()) throw new Error('Storage cleanup failed');
        }
        await this.db.$transaction(async (tx) => {
          await lockDemo(tx);
          const lease = await tx.demoSession.findUniqueOrThrow({
            where: { id: session.id },
          });
          if (
            lease.cleanupOwner !== owner ||
            !lease.cleanupLeaseUntil ||
            lease.cleanupLeaseUntil <= new Date()
          )
            throw new Error('Cleanup lease expired');
          const member = { demoSessionId: session.id };
          await tx.applicantEvaluation.deleteMany({
            where: { jobApplicant: { applicant: member } },
          });
          await tx.jobApplicant.deleteMany({ where: { applicant: member } });
          await tx.resumeContent.deleteMany({
            where: { resume: { user: member } },
          });
          await tx.resume.deleteMany({ where: { user: member } });
          await tx.jobSkill.deleteMany({ where: { job: { user: member } } });
          await tx.job.deleteMany({ where: { user: member } });
          await tx.refreshToken.deleteMany({ where: { user: member } });
          await tx.applicantProfile.deleteMany({ where: { user: member } });
          await tx.companyProfile.deleteMany({ where: { user: member } });
          await tx.user.deleteMany({ where: member });
          await tx.demoUpload.deleteMany({ where: { sessionId: session.id } });
          await tx.demoSession.update({
            where: { id: session.id },
            data: {
              cleanupStatus: 'DONE',
              companyUserId: null,
              applicantUserId: null,
            },
          });
        });
        this.logger.log('demo.cleanup.completed');
        demoMetrics.cleanup('completed');
      } catch {
        await this.db.demoSession.updateMany({
          where: {
            id: session.id,
            cleanupOwner: owner,
            cleanupStatus: { not: 'DONE' },
          },
          data: { cleanupStatus: 'FAILED' },
        });
        this.logger.error('demo.cleanup.failed');
        demoMetrics.cleanup('failed');
      } finally {
        await this.db.demoSession.updateMany({
          where: { id: session.id, cleanupOwner: owner },
          data: { cleanupOwner: null, cleanupLeaseUntil: null },
        });
      }
    }
    // Creation accounting needs session tombstones for the rolling hour.
    await this.db.demoSession.deleteMany({
      where: {
        cleanupStatus: 'DONE',
        createdAt: { lt: new Date(Date.now() - 86400000) },
      },
    });
    await this.db.demoUsage.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 86400000) } },
    });
  }
}
