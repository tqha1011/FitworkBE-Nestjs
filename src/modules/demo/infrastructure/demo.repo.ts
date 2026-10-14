import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from 'generated/prisma/client';
import { UserType } from 'generated/prisma/enums';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonUserRole } from 'src/shared/domain/enum';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { buildJobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { createResumeEvaluationSnapshot } from 'src/modules/applicant-evaluation/application/services/resume-redact-evaluation';
import { validateEvaluationV2 } from 'src/modules/applicant-evaluation/application/services/evaluation-v2-validator';
import { APPLICANT_EVALUATION_PROMPT_VERSION_V2 } from 'src/modules/applicant-evaluation/application/constants/applicant-evaluation.constants';
import { assertDemoIdentity } from '../domain/demo-policy';
import { demoCandidates, demoJobs } from '../domain/demo-fixtures';
import {
  DemoLimits,
  DemoLoginState,
  DemoSessionView,
  IDemoRepository,
} from '../domain/demo.repo.interface';
import { consumeDemoUsage, lockDemo } from './demo-transaction';

@Injectable()
export class DemoRepository implements IDemoRepository {
  constructor(private readonly db: PrismaService) {}

  async create(
    ipHash: string,
    userType: UserType,
    tokenHash: string,
    passwordHashed: string,
    sampleSizes: number[],
    limits: DemoLimits,
  ): Promise<DemoLoginState> {
    return this.db.$transaction(
      async (tx) => {
        await lockDemo(tx);
        const now = new Date();
        const active = await tx.demoSession.count({
          where: { revokedAt: null, expiresAt: { gt: now } },
        });
        if (active >= limits.maxActiveSessions)
          throw new AppError(
            ErrorCode.TooManyRequests,
            'Demo is busy. Please try again later',
          );
        // Rolling hour, not an aligned window that permits a boundary burst.
        const recent = await tx.demoSession.count({
          where: {
            ipHash,
            createdAt: { gt: new Date(now.getTime() - 3600000) },
          },
        });
        if (recent >= limits.sessionsPerIpHour)
          throw new AppError(
            ErrorCode.TooManyRequests,
            'Demo session creation limit reached',
          );
        const id = randomUUID();
        const expiresAt = new Date(
          now.getTime() + limits.sessionSeconds * 1000,
        );
        await tx.demoSession.create({
          data: { id, expiresAt, ipHash, activeUserType: userType },
        });
        const company = await tx.user.create({
          data: {
            email: `company.${id}@demo.fitwork.invalid`,
            username: 'demo_company',
            fullName: 'Sen Viet Recruiter',
            passwordHashed,
            userType: 'COMPANY',
            role: 'ROLE_COMPANY',
            demoSessionId: id,
            companyProfile: {
              create: {
                companyName: 'Sen Viet Digital',
                description: 'A sample product studio for the FitWork demo.',
                location: 'Ho Chi Minh City',
                industry: 'Software',
              },
            },
          },
        });
        const candidates = [];
        for (const candidate of demoCandidates) {
          candidates.push(
            await tx.user.create({
              data: {
                email: `${candidate.key}.${id}@demo.fitwork.invalid`,
                username: `demo_${candidate.key}`,
                fullName: candidate.name,
                passwordHashed,
                userType: 'APPLICANT',
                role: 'ROLE_APPLICANT',
                demoSessionId: id,
                applicantProfile: {
                  create: {
                    description: 'Sample applicant',
                    skills: candidate.skills.join(', '),
                    experienceYears: 4,
                    location: 'Ho Chi Minh City',
                  },
                },
              },
            }),
          );
        }
        const session = await tx.demoSession.update({
          where: { id },
          data: {
            companyUserId: company.id,
            applicantUserId: candidates[0].id,
          },
        });
        const savedJobs = [];
        for (const template of demoJobs) {
          // Stable catalog identities reused across workspaces; never removed by cleanup.
          const catalogId = (name: string) => {
            const hex = createHash('sha256')
              .update(`fitwork:demo:catalog:${name}`)
              .digest('hex');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
          };
          const category = await tx.category.upsert({
            where: { publicId: catalogId(template.category) },
            update: {},
            create: {
              publicId: catalogId(template.category),
              name: template.category,
            },
          });
          const arrangement =
            (await tx.arrangement.findFirst({
              where: { name: 'Remote' },
              orderBy: { id: 'asc' },
            })) ?? (await tx.arrangement.create({ data: { name: 'Remote' } }));
          const skills = [];
          for (const name of template.skills)
            skills.push(
              await tx.skill.upsert({
                where: { publicId: catalogId(name) },
                update: {},
                create: { publicId: catalogId(name), name },
              }),
            );
          const job = await tx.job.create({
            data: {
              title: template.title,
              description:
                'Deliver a customer portal for a Vietnamese product studio. Collaborate with a team of six and document handover.',
              requirements: `Professional experience with ${template.skills.join(', ')}. Clear communication and reliable delivery.`,
              location: 'Ho Chi Minh City',
              status: 'OPEN',
              dueAt: new Date(now.getTime() + 14 * 86400000),
              budget: 15000000,
              budgetInBaseCurrency: 15000000,
              postedBy: company.id,
              categoryId: category.id,
              arrangementId: arrangement.id,
              jobSkills: {
                create: skills.map((skill) => ({ skillId: skill.id })),
              },
            },
          });
          const snapshot = buildJobSnapshotV2({
            schemaVersion: 1,
            publicId: job.publicId,
            title: job.title,
            description: job.description,
            requirements: job.requirements,
            location: job.location,
            skills: skills.map((s) => ({ id: s.id, name: s.name })),
            category: { id: category.id, name: category.name },
            arrangement: { id: arrangement.id, name: arrangement.name },
          });
          savedJobs.push({ job, snapshot });
        }
        const featured = savedJobs[0];
        for (let i = 0; i < candidates.length; i++) {
          const candidate = demoCandidates[i];
          const storagePath = `demo/samples/v1/${candidate.key}.pdf`;
          const file = {
            storagePath,
            fileSize: sampleSizes[i],
            fileType: 'PDF' as const,
            fileName: `${candidate.name} CV.pdf`,
          };
          const resume = await tx.resume.create({
            data: { ...file, userId: candidates[i].id },
          });
          const contentHash = createHash('sha256')
            .update(candidate.text)
            .digest('hex');
          const content = await tx.resumeContent.create({
            data: {
              ...file,
              resumeId: resume.id,
              status: 'COMPLETED',
              extractedText: candidate.text,
              contentHash,
              parserVersion: 'demo-text-v1',
              completedAt: now,
            },
          });
          const jobContentHash = hashCanonicalJson(featured.snapshot);
          const application = await tx.jobApplicant.create({
            data: {
              jobId: featured.job.id,
              applicantId: candidates[i].id,
              resumeId: resume.id,
              resumeContentId: content.id,
              jobSnapshot: featured.snapshot,
              jobContentHash,
              coverLetter:
                'I would love to contribute to your customer portal.',
              proposedRate: 15000000,
              estimatedDay: 30,
            },
          });
          const redacted = createResumeEvaluationSnapshot(candidate.text);
          const evidence = {
            schemaVersion: 2 as const,
            criteria: featured.snapshot.criteria.map((criterion, index) => {
              const skill = featured.snapshot.skills[index].name;
              const start = redacted.text.indexOf(skill);
              const matched = start >= 0;
              return {
                criterionId: criterion.id,
                criterionText: criterion.text,
                verdict: matched ? ('MATCHED' as const) : ('MISSING' as const),
                scoreContribution: matched ? criterion.weight : 0,
                explanation: matched
                  ? 'The CV explicitly lists this skill.'
                  : 'No evidence of this skill in the CV.',
                evidence: matched
                  ? [
                      {
                        snippet: skill,
                        section: 'resume' as const,
                        startOffset: start,
                        endOffset: start + skill.length,
                      },
                    ]
                  : [],
              };
            }),
            strengths: candidate.skills.map((s) => `Experience with ${s}`),
            gaps: featured.snapshot.skills
              .filter((s) => !redacted.text.includes(s.name))
              .map((s) => `No evidence of ${s.name}`),
            explanation:
              'Illustrative sample based on the cited CV. Review the evidence before making a hiring decision.',
          };
          const validated = validateEvaluationV2(
            featured.snapshot.criteria,
            redacted.text,
            evidence,
          );
          await tx.applicantEvaluation.create({
            data: {
              jobApplicantId: application.id,
              resumeContentId: content.id,
              status: 'COMPLETED',
              source: 'SAMPLE',
              model: 'fitwork-demo-sample-v1',
              promptVersion: APPLICANT_EVALUATION_PROMPT_VERSION_V2,
              parserVersion: content.parserVersion,
              resumeContentHash: contentHash,
              jobContentHash,
              jobSnapshot: featured.snapshot,
              redactedResumeText: redacted.text,
              redactedResumeHash: redacted.hash,
              redactionVersion: redacted.redactionVersion,
              overallScore: validated.overallScore,
              scoreBreakdown: validated.scoreBreakdown,
              evidence: validated.evidence,
              evaluatedAt: now,
            },
          });
        }
        const user = userType === 'COMPANY' ? company : candidates[0];
        await tx.refreshToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        });
        return { id, expiresAt, generation: session.generation, user };
      },
      { timeout: 30000 },
    );
  }

  private async identity(tx: Prisma.TransactionClient, payload: JwtPayload) {
    const [session, user] = await Promise.all([
      tx.demoSession.findUnique({ where: { id: payload.demoSessionId! } }),
      tx.user.findUnique({ where: { publicId: payload.sub } }),
    ]);
    assertDemoIdentity(payload, session, user);
    return { session: session!, user: user! };
  }
  async authorize(payload: JwtPayload) {
    await this.identity(this.db, payload);
  }
  async principal(publicId: string): Promise<JwtPayload | null> {
    const user = await this.db.user.findUnique({
      where: { publicId },
      include: { demoSession: true },
    });
    if (!user?.demoSessionId) return null;
    const payload: JwtPayload = {
      sub: user.publicId as JwtPayload['sub'],
      email: user.email,
      role: user.role as JwtPayload['role'],
      demoSessionId: user.demoSessionId,
      demoGeneration: user.demoSession?.generation,
      demoExpiresAt: user.demoSession?.expiresAt.getTime(),
    };
    assertDemoIdentity(payload, user.demoSession, user);
    return payload;
  }
  async canReadResume(publicId: string, resumePublicId: string) {
    const payload = await this.principal(publicId);
    if (!payload || payload.role !== CommonUserRole.ROLE_COMPANY) return false;
    return !!(await this.db.resume.findFirst({
      where: {
        publicId: resumePublicId,
        user: { demoSessionId: payload.demoSessionId },
        jobApplicants: { some: { job: { user: { publicId } } } },
      },
      select: { id: true },
    }));
  }
  async validateUpload(
    publicId: string,
    key: string,
    bytes: number,
    limits: DemoLimits,
  ) {
    const payload = await this.principal(publicId);
    if (!payload) return;
    const record = await this.db.demoUpload.findUnique({ where: { key } });
    if (!record || record.sessionId !== payload.demoSessionId)
      throw new AppError(
        ErrorCode.Forbidden,
        'Demo upload URL was not issued for this file',
      );
    if (bytes < 1 || bytes > limits.maxFileBytes)
      throw new AppError(ErrorCode.BadRequest, 'Demo file is too large');
  }

  async switchRole(payload: JwtPayload, userType: UserType, tokenHash: string) {
    return this.db.$transaction(async (tx) => {
      await lockDemo(tx);
      const { session } = await this.identity(tx, payload);
      const user = await tx.user.findUniqueOrThrow({
        where: {
          id: (userType === 'COMPANY'
            ? session.companyUserId
            : session.applicantUserId)!,
        },
      });
      await tx.refreshToken.updateMany({
        where: { user: { demoSessionId: session.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const updated = await tx.demoSession.update({
        where: { id: session.id },
        data: { generation: { increment: 1 }, activeUserType: userType },
      });
      await tx.refreshToken.create({
        data: { userId: user.id, tokenHash, expiresAt: session.expiresAt },
      });
      return {
        id: session.id,
        expiresAt: session.expiresAt,
        generation: updated.generation,
        user,
      };
    });
  }

  async refresh(tokenHash: string, nextTokenHash: string) {
    return this.db.$transaction(async (tx) => {
      await lockDemo(tx);
      const token = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { demoSession: true } } },
      });
      const session = token?.user.demoSession;
      const activeId =
        session?.activeUserType === 'COMPANY'
          ? session.companyUserId
          : session?.applicantUserId;
      if (
        !token ||
        token.revokedAt ||
        token.expiresAt <= new Date() ||
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !token.user.isActive ||
        token.userId !== activeId
      ) {
        // An obsolete role cookie is rejected without killing the new role.
        throw new AppError(
          ErrorCode.Unauthorized,
          'Demo expired — Start new demo',
        );
      }
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: {
          userId: token.userId,
          tokenHash: nextTokenHash,
          expiresAt: session.expiresAt,
        },
      });
      return {
        id: session.id,
        expiresAt: session.expiresAt,
        generation: session.generation,
        user: token.user,
      };
    });
  }

  async revoke(payload?: JwtPayload, tokenHash?: string) {
    await this.db.$transaction(async (tx) => {
      await lockDemo(tx);
      let id = payload?.demoSessionId;
      if (payload) await this.identity(tx, payload);
      if (!id && tokenHash) {
        const token = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });
        if (token && !token.revokedAt && token.expiresAt > new Date())
          id = token.user.demoSessionId ?? undefined;
      }
      if (!id) return;
      await tx.demoSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { user: { demoSessionId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async authorizeResources(payload: JwtPayload, ids: Record<string, unknown>) {
    const sessionId = payload.demoSessionId!;
    const checkId = (value: unknown): value is string =>
      typeof value === 'string' && value.length > 0;
    let allowed = true;
    if (checkId(ids.jobPublicId))
      allowed &&= !!(await this.db.job.findFirst({
        where: {
          publicId: ids.jobPublicId,
          user: { demoSessionId: sessionId },
        },
        select: { id: true },
      }));
    if (checkId(ids.resumePublicId))
      allowed &&= !!(await this.db.resume.findFirst({
        where: {
          publicId: ids.resumePublicId,
          user: { demoSessionId: sessionId },
        },
        select: { id: true },
      }));
    if (checkId(ids.jobApplicantPublicId))
      allowed &&= !!(await this.db.jobApplicant.findFirst({
        where: {
          publicId: ids.jobApplicantPublicId,
          job: { user: { demoSessionId: sessionId } },
          applicant: { demoSessionId: sessionId },
        },
        select: { id: true },
      }));
    if (checkId(ids.evaluationPublicId))
      allowed &&= !!(await this.db.applicantEvaluation.findFirst({
        where: {
          publicId: ids.evaluationPublicId,
          jobApplicant: {
            job: { user: { demoSessionId: sessionId } },
            applicant: { demoSessionId: sessionId },
          },
        },
        select: { id: true },
      }));
    if (!allowed)
      throw new AppError(ErrorCode.NotFound, 'Demo resource not found');
  }

  async rateLimit(payload: JwtPayload, limit: number) {
    await this.db.$transaction(async (tx) => {
      await lockDemo(tx);
      await this.identity(tx, payload);
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      await consumeDemoUsage(
        tx,
        `request:${payload.demoSessionId}:${minute}`,
        limit,
        new Date((minute + 1) * 60000),
      );
    });
  }

  async reserveUpload(
    payload: JwtPayload,
    key: string,
    expiresAt: Date,
    fileSize: number,
    limits: DemoLimits,
  ) {
    if (
      !Number.isSafeInteger(fileSize) ||
      fileSize < 1 ||
      fileSize > limits.maxFileBytes
    )
      throw new AppError(
        ErrorCode.BadRequest,
        'Demo uploads must be at most 5 MiB',
      );
    await this.db.$transaction(async (tx) => {
      await lockDemo(tx);
      const { session } = await this.identity(tx, payload);
      if (session.uploadUrls >= limits.uploadsPerSession)
        throw new AppError(
          ErrorCode.TooManyRequests,
          'Demo upload limit reached',
        );
      if (!key.startsWith(`user/${payload.sub}/`))
        throw new AppError(ErrorCode.Forbidden, 'Invalid demo storage key');
      await tx.demoUpload.create({
        data: { key, sessionId: session.id, expiresAt },
      });
      await tx.demoSession.update({
        where: { id: session.id },
        data: { uploadUrls: { increment: 1 } },
      });
    });
  }

  async view(
    payload: JwtPayload,
    limits: DemoLimits,
  ): Promise<DemoSessionView> {
    const { session } = await this.identity(this.db, payload);
    const jobs = await this.db.job.findMany({
      where: { postedBy: session.companyUserId! },
      orderBy: { id: 'asc' },
      include: {
        jobApplicants: {
          include: {
            applicant: true,
            resume: true,
            evaluations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
          },
        },
      },
    });
    const applications = jobs.flatMap((job) =>
      job.jobApplicants
        .filter(
          (a) =>
            payload.role === CommonUserRole.ROLE_COMPANY ||
            a.applicantId === session.applicantUserId,
        )
        .map((a) => ({
          publicId: a.publicId,
          jobPublicId: job.publicId,
          resumePublicId: a.resume.publicId,
          applicantName: a.applicant.fullName,
          isPrimaryApplicant: a.applicantId === session.applicantUserId,
          status: a.status,
          sampleEvaluationPublicId:
            a.evaluations.find((e) => e.source === 'SAMPLE')?.publicId ?? null,
          latestEvaluationPublicId: a.evaluations[0]?.publicId ?? null,
          evaluations: a.evaluations.map((e) => ({
            publicId: e.publicId,
            source: e.source,
            status: e.status,
            overallScore: e.overallScore,
          })),
        })),
    );
    const resumes = await this.db.resume.findMany({
      where: {
        user: { demoSessionId: session.id },
        ...(payload.role === CommonUserRole.ROLE_APPLICANT
          ? { userId: session.applicantUserId! }
          : {}),
      },
      select: { publicId: true, fileName: true, userId: true },
    });
    const day = new Date().toISOString().slice(0, 10);
    const usage = await this.db.demoUsage.findMany({
      where: {
        key: { in: [`ai:global:${day}`, `ai:ip:${session.ipHash}:${day}`] },
      },
    });
    const remaining = Math.max(
      0,
      Math.min(
        limits.aiPerSession - session.aiRuns,
        limits.aiPerDay -
          (usage.find((u) => u.key === `ai:global:${day}`)?.count ?? 0),
        limits.aiPerIpDay -
          (usage.find((u) => u.key === `ai:ip:${session.ipHash}:${day}`)
            ?.count ?? 0),
      ),
    );
    return {
      id: session.id,
      expiresAt: session.expiresAt,
      userType: session.activeUserType,
      generation: session.generation,
      ai: {
        used: session.aiRuns,
        limit: limits.aiPerSession,
        remaining,
        available: true,
        unavailableReason: null,
      },
      uploads: {
        used: session.uploadUrls,
        limit: limits.uploadsPerSession,
        remaining: Math.max(0, limits.uploadsPerSession - session.uploadUrls),
        maxFileBytes: limits.maxFileBytes,
      },
      jobs: jobs.map((j, i) => ({
        publicId: j.publicId,
        title: j.title,
        isFeatured: i === 0,
      })),
      resumes: resumes.map((r) => ({
        publicId: r.publicId,
        fileName: r.fileName,
        isPrimaryApplicant: r.userId === session.applicantUserId,
      })),
      applications,
    };
  }
}
