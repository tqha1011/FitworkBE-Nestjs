/* eslint-disable @typescript-eslint/require-await -- asynchronous storage test doubles */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/infrastructure/database/prisma.service';
import { IFileStorage } from '../src/shared/infrastructure/storage/file-storage.interface';
import { IApplicantEvaluationLlm } from '../src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface';
import type { ApplicantEvaluationLlmInput } from '../src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface';
import { DemoService } from '../src/modules/demo/application/demo.service';
import { ok, err } from 'neverthrow';
import { AppError, ErrorCode } from '../src/shared/common/errorCode';
import { JwtService } from '@nestjs/jwt';
import { validateEvaluationV2 } from '../src/modules/applicant-evaluation/application/services/evaluation-v2-validator';
import { JobSnapshotV2 } from '../src/modules/job/domain/value-objects/job-snapshot';
import { EvaluationEvidenceV2 } from '../src/modules/applicant-evaluation/domain/value-objects/evaluation';
import { DemoSessionView } from '../src/modules/demo/domain/demo.repo.interface';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName } from '../src/shared/infrastructure/queue/constant/queue-name';
import { io } from 'socket.io-client';
import type { Server } from 'http';

const database = process.env.DEMO_TEST_DATABASE_URL;
const suite = database ? describe : describe.skip;
suite('demo API with PostgreSQL and BullMQ', () => {
  let app: INestApplication;
  let db: PrismaService;
  let demo: DemoService;
  let first: { accessToken: string; cookie: string; session: DemoSessionView };
  let second: typeof first;
  const deleted: string[] = [];
  let storageFailure = false;
  let aiCalls = 0;
  let aiSuccess = false;
  let aiBlock: Promise<never> | null = null;
  let aiBlockStarted: (() => void) | undefined;
  const storage = {
    getObjectMetadata: async () =>
      ok({
        contentType: 'application/pdf',
        contentLength: 2048,
        lastModified: null,
      }),
    getDownloadUrl: async (key: string) => ok(`https://storage.test/${key}`),
    getUploadUrl: async ({ key }: { key: string }) =>
      ok({
        key,
        uploadUrl: `https://storage.test/${key}`,
        expiresAt: new Date(Date.now() + 300000),
      }),
    getObject: async () => ok(Buffer.from('test')),
    deleteObject: async (key: string) => {
      if (storageFailure)
        return err(
          new AppError(ErrorCode.InternalServerError, 'Storage unavailable'),
        );
      deleted.push(key);
      return ok(undefined);
    },
  };
  beforeAll(async () => {
    if (!database || !new URL(database).pathname.endsWith('_test'))
      throw new Error('Use a dedicated *_test database');
    process.env.DATABASE_URL = database;
    process.env.DEMO_ENABLED = 'true';
    process.env.JWT_SECRET = 'demo-test-secret';
    process.env.LLM_EVALUATION_MODEL = 'test-model';
    process.env.DEMO_SESSIONS_PER_IP_HOUR = '100';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IFileStorage)
      .useValue(storage)
      .overrideProvider(IApplicantEvaluationLlm)
      .useValue({
        evaluate: (input: ApplicantEvaluationLlmInput) => {
          aiCalls++;
          if (aiBlock) {
            aiBlockStarted?.();
            return aiBlock;
          }
          if (!aiSuccess)
            return Promise.resolve(err(new Error('Test AI unavailable')));
          const snapshot = input.jobSnapshot as JobSnapshotV2;
          const evidence: EvaluationEvidenceV2 = {
            schemaVersion: 2,
            strengths: ['Explicit skill evidence'],
            gaps: [],
            explanation: 'Validated live test response',
            criteria: snapshot.criteria.map((criterion, index) => {
              const snippet = snapshot.skills[index].name;
              const start = input.resumeText.indexOf(snippet);
              return {
                criterionId: criterion.id,
                criterionText: criterion.text,
                verdict: start >= 0 ? 'MATCHED' : 'MISSING',
                scoreContribution: start >= 0 ? criterion.weight : 0,
                explanation: 'Based on cited skills',
                evidence:
                  start >= 0
                    ? [
                        {
                          section: 'resume',
                          snippet,
                          startOffset: start,
                          endOffset: start + snippet.length,
                        },
                      ]
                    : [],
              };
            }),
          };
          return Promise.resolve(ok({ schemaVersion: 2 as const, evidence }));
        },
      })
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    demo = app.get(DemoService);
    // Only a dedicated disposable *_test database is allowed above.
    await db.demoSession.updateMany({ data: { revokedAt: new Date() } });
    await db.demoUpload.updateMany({ data: { expiresAt: new Date(0) } });
    await demo.cleanup();
    await db.demoUsage.deleteMany({});
  }, 30000);
  afterAll(async () => {
    await app?.close();
  });
  const create = async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/auth/demo')
      .send({})
      .expect(201);
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    const detail = await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth((res.body as { accessToken: string }).accessToken, {
        type: 'bearer',
      })
      .expect(200);
    return {
      accessToken: (res.body as { accessToken: string }).accessToken,
      cookie,
      session: detail.body as DemoSessionView,
    };
  };
  it('creates complete private workspaces and validates all V2 samples without calling AI', async () => {
    first = await create();
    second = await create();
    expect(first.session.jobs).toHaveLength(3);
    expect(first.session.applications).toHaveLength(3);
    expect(first.session.ai.remaining).toBe(3);
    expect(first.session.userType).toBe('COMPANY');
    expect(first.session.id).not.toBe(second.session.id);
    const samples = await db.applicantEvaluation.findMany({
      where: {
        jobApplicant: { applicant: { demoSessionId: first.session.id } },
      },
    });
    expect(samples).toHaveLength(3);
    expect(samples.map((s) => s.overallScore).sort((a, b) => a! - b!)).toEqual([
      0, 33, 100,
    ]);
    for (const sample of samples) {
      expect(sample.source).toBe('SAMPLE');
      expect(
        validateEvaluationV2(
          (sample.jobSnapshot as JobSnapshotV2).criteria,
          sample.redactedResumeText!,
          sample.evidence as unknown as EvaluationEvidenceV2,
        ).overallScore,
      ).toBe(sample.overallScore);
    }
    expect(aiCalls).toBe(0);
    const tokens = app
      .get(JwtService)
      .decode<{ demoSessionId: string; exp: number }>(first.accessToken);
    expect(tokens.demoSessionId).toBe(first.session.id);
    expect(tokens.exp * 1000).toBeLessThanOrEqual(
      new Date(first.session.expiresAt).getTime(),
    );
  });
  it('filters both search rows and total count to the workspace', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/job?pageSize=1')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    expect((res.body as { totalPages: number }).totalPages).toBe(3);
    expect(
      (res.body as { items: Array<{ publicId: string }> }).items,
    ).toHaveLength(1);
    expect(first.session.jobs.map((j) => j.publicId)).toContain(
      (res.body as { items: Array<{ publicId: string }> }).items[0].publicId,
    );
  });
  it('blocks ordinary auth, invalid role and non-demo JWTs', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/auth/login')
      .send({ email: 'a@test.invalid', password: 'password' })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/register')
      .send({})
      .expect(404);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/demo')
      .send({ userType: 'ADMIN' })
      .expect(400);
    const token = await app
      .get(JwtService)
      .signAsync({ sub: 'normal', role: 'ROLE_COMPANY' });
    await request(app.getHttpServer() as Server)
      .get('/api/job')
      .auth(token, { type: 'bearer' })
      .expect(401);
  });
  it('lets the recruiter read owned samples and sample CVs, rejects other sessions', async () => {
    const a = first.session.applications[0];
    const other = second.session.applications[0];
    const result = await request(app.getHttpServer() as Server)
      .get(
        `/api/applicant-evaluation/jobs/${a.jobPublicId}/${a.sampleEvaluationPublicId}`,
      )
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    expect((result.body as { source: string }).source).toBe('SAMPLE');
    await request(app.getHttpServer() as Server)
      .get(`/api/resume/${a.resumePublicId}/download-url?disposition=inline`)
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get(`/api/resume/${other.resumePublicId}/download-url`)
      .auth(first.accessToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get(
        `/api/applicant-evaluation/jobs/${other.jobPublicId}/${other.sampleEvaluationPublicId}`,
      )
      .auth(first.accessToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .patch(`/api/job/applicants/${other.publicId}/status`)
      .auth(first.accessToken, { type: 'bearer' })
      .send({ status: 'ACCEPTED' })
      .expect(404);
  });
  it('switches in the same workspace and rejects old access and refresh tokens', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/auth/demo/switch')
      .auth(first.accessToken, { type: 'bearer' })
      .send({ userType: 'APPLICANT' })
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/refresh')
      .set('Cookie', first.cookie)
      .expect(401);
    first.accessToken = (res.body as { accessToken: string }).accessToken;
    first.cookie = res.headers['set-cookie'][0].split(';')[0];
    const detail = await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    expect((detail.body as DemoSessionView).id).toBe(first.session.id);
    expect((detail.body as DemoSessionView).userType).toBe('APPLICANT');
    const refreshed = await request(app.getHttpServer() as Server)
      .post('/api/auth/refresh')
      .set('Cookie', first.cookie)
      .expect(200);
    first.accessToken = (refreshed.body as { accessToken: string }).accessToken;
    first.cookie = refreshed.headers['set-cookie'][0].split(';')[0];
    const a = first.session.applications.find((a) => a.isPrimaryApplicant)!;
    await request(app.getHttpServer() as Server)
      .get(
        `/api/applicant-evaluation/${a.jobPublicId}?evaluationPublicId=${a.sampleEvaluationPublicId}`,
      )
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    const b = second.session.applications[0];
    await request(app.getHttpServer() as Server)
      .post(`/api/job/${b.jobPublicId}/apply`)
      .auth(first.accessToken, { type: 'bearer' })
      .send({
        resumePublicId: a.resumePublicId,
        coverLetter: 'demo',
        proposedRate: 100000,
        estimatedDay: 7,
      })
      .expect(404);
    await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(first.accessToken, { type: 'bearer' })
      .send({ jobPublicId: b.jobPublicId, resumePublicId: a.resumePublicId })
      .expect(404);
  });
  it('rolls back every workspace row when fixture creation fails mid-transaction', async () => {
    const before = await Promise.all([
      db.demoSession.count(),
      db.user.count(),
      db.job.count(),
      db.resume.count(),
    ]);
    await db.$executeRawUnsafe(
      "CREATE FUNCTION demo_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fixture failure'; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER demo_test_reject BEFORE INSERT ON applicant_evaluation FOR EACH ROW EXECUTE FUNCTION demo_test_reject()',
    );
    try {
      await request(app.getHttpServer() as Server)
        .post('/api/auth/demo')
        .send({})
        .expect(500);
      expect(
        await Promise.all([
          db.demoSession.count(),
          db.user.count(),
          db.job.count(),
          db.resume.count(),
        ]),
      ).toEqual(before);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER demo_test_reject ON applicant_evaluation',
      );
      await db.$executeRawUnsafe('DROP FUNCTION demo_test_reject()');
    }
  });
  it('caps creation and HTTP requests with PostgreSQL accounting', async () => {
    const config = app.get(ConfigService);
    config.set('DEMO_MAX_ACTIVE_SESSIONS', '1');
    await request(app.getHttpServer() as Server)
      .post('/api/auth/demo')
      .send({})
      .expect(429);
    config.set('DEMO_MAX_ACTIVE_SESSIONS', '20');
    config.set('DEMO_SESSIONS_PER_IP_HOUR', '1');
    await request(app.getHttpServer() as Server)
      .post('/api/auth/demo')
      .send({})
      .expect(429);
    config.set('DEMO_SESSIONS_PER_IP_HOUR', '100');
    config.set('DEMO_REQUESTS_PER_MINUTE', '1');
    await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(429);
    config.set('DEMO_REQUESTS_PER_MINUTE', '1000');
  });
  it('applies to another job and atomically charges duplicates once; retries and new sessions keep daily quota', async () => {
    const config = app.get(ConfigService);
    const evaluationQueue = app.get<Queue>(
      getQueueToken(QueueName.LlmEvaluation),
    );
    const a = first.session.applications.find((a) => a.isPrimaryApplicant)!;
    const job = first.session.jobs.find((j) => !j.isFeatured)!;
    await request(app.getHttpServer() as Server)
      .post(`/api/job/${job.publicId}/apply`)
      .auth(first.accessToken, { type: 'bearer' })
      .send({
        resumePublicId: a.resumePublicId,
        coverLetter: 'I would like to contribute to your team.',
        proposedRate: 15000000,
        estimatedDay: 30,
      })
      .expect(201);
    await evaluationQueue.pause();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer() as Server)
          .post('/api/applicant-evaluation')
          .auth(first.accessToken, { type: 'bearer' })
          .send({
            jobPublicId: job.publicId,
            resumePublicId: a.resumePublicId,
          }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    const ids = responses.map((r) => (r.body as { publicId: string }).publicId);
    expect(new Set(ids).size).toBe(1);
    expect(
      (
        await db.demoSession.findUniqueOrThrow({
          where: { id: first.session.id },
        })
      ).aiRuns,
    ).toBe(1);
    expect((await evaluationQueue.getJob(ids[0]))!.opts.attempts).toBe(1);
    // Queue persistence/reconnection has no effect on the PostgreSQL budget.
    const waitFailed = async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (
          (
            await db.applicantEvaluation.findUniqueOrThrow({
              where: { publicId: ids[0] },
            })
          ).status === 'FAILED'
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Worker did not finish');
    };
    await evaluationQueue.resume();
    await waitFailed();
    const run = () =>
      request(app.getHttpServer() as Server)
        .post('/api/applicant-evaluation')
        .auth(first.accessToken, { type: 'bearer' })
        .send({ jobPublicId: job.publicId, resumePublicId: a.resumePublicId });
    await run().expect(201);
    await waitFailed();
    await run().expect(201);
    await waitFailed();
    await run().expect(429);
    expect(
      (
        await db.demoSession.findUniqueOrThrow({
          where: { id: first.session.id },
        })
      ).aiRuns,
    ).toBe(3);
    expect(aiCalls).toBe(3);
    await request(app.getHttpServer() as Server)
      .get(
        `/api/applicant-evaluation/${a.jobPublicId}?evaluationPublicId=${a.sampleEvaluationPublicId}`,
      )
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    const fresh = await create();
    const switched = await request(app.getHttpServer() as Server)
      .post('/api/auth/demo/switch')
      .auth(fresh.accessToken, { type: 'bearer' })
      .send({ userType: 'APPLICANT' })
      .expect(200);
    const token = (switched.body as { accessToken: string }).accessToken;
    const freshApplication = fresh.session.applications.find(
      (a) => a.isPrimaryApplicant,
    )!;
    config.set('DEMO_AI_PER_DAY', '3');
    await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(token, { type: 'bearer' })
      .send({
        jobPublicId: freshApplication.jobPublicId,
        resumePublicId: freshApplication.resumePublicId,
      })
      .expect(429);
    config.set('DEMO_AI_PER_DAY', '30');
    config.set('DEMO_AI_PER_IP_DAY', '3');
    await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(token, { type: 'bearer' })
      .send({
        jobPublicId: freshApplication.jobPublicId,
        resumePublicId: freshApplication.resumePublicId,
      })
      .expect(429);
    config.set('DEMO_AI_PER_IP_DAY', '6');
    expect(
      (
        await db.demoSession.findUniqueOrThrow({
          where: { id: fresh.session.id },
        })
      ).aiRuns,
    ).toBe(0);
    config.set('LLM_EVALUATION_KEY', '');
    await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(token, { type: 'bearer' })
      .send({
        jobPublicId: freshApplication.jobPublicId,
        resumePublicId: freshApplication.resumePublicId,
      })
      .expect(503);
    config.set('LLM_EVALUATION_KEY', 'demo-test-key');
    aiSuccess = true;
    await evaluationQueue.pause();
    const live = await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(token, { type: 'bearer' })
      .send({
        jobPublicId: freshApplication.jobPublicId,
        resumePublicId: freshApplication.resumePublicId,
      })
      .expect(201);
    const liveId = (live.body as { publicId: string }).publicId;
    const address = (app.getHttpServer() as Server).address() as {
      port: number;
    };
    const socket = io(`http://127.0.0.1:${address.port}/evaluation`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const joined = new Promise<void>((resolve) =>
        socket.once('evaluation-join', (data: { joined: boolean }) => {
          expect(data.joined).toBe(true);
          resolve();
        }),
      );
      socket.emit('evaluation-join', { evaluationPublicId: liveId });
      await joined;
      const completed = new Promise<void>((resolve) =>
        socket.on('evaluation-score-notify', (data: { status: string }) => {
          if (data.status === 'COMPLETED') resolve();
        }),
      );
      await evaluationQueue.resume();
      await completed;
      const reused = await request(app.getHttpServer() as Server)
        .post('/api/applicant-evaluation')
        .auth(token, { type: 'bearer' })
        .send({
          jobPublicId: freshApplication.jobPublicId,
          resumePublicId: freshApplication.resumePublicId,
        })
        .expect(201);
      expect((reused.body as { publicId: string }).publicId).toBe(liveId);
      expect(
        (
          await db.demoSession.findUniqueOrThrow({
            where: { id: fresh.session.id },
          })
        ).aiRuns,
      ).toBe(1);
      const detail = await request(app.getHttpServer() as Server)
        .get(
          `/api/applicant-evaluation/${freshApplication.jobPublicId}?evaluationPublicId=${liveId}`,
        )
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        (detail.body as { source: string; overallScore: number }).source,
      ).toBe('LIVE');
      expect((detail.body as { overallScore: number }).overallScore).toBe(100);
      await request(app.getHttpServer() as Server)
        .get(
          `/api/applicant-evaluation/${freshApplication.jobPublicId}?evaluationPublicId=${freshApplication.sampleEvaluationPublicId}`,
        )
        .auth(token, { type: 'bearer' })
        .expect(200);
    } finally {
      socket.disconnect();
      aiSuccess = false;
    }
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .auth(token, { type: 'bearer' })
      .expect(204);
  }, 15000);
  it('authenticates real Socket.IO clients and disconnects them when the role changes', async () => {
    const address = (app.getHttpServer() as Server).address() as {
      port: number;
    };
    const socket = io(`http://127.0.0.1:${address.port}/evaluation`, {
      auth: { token: first.accessToken },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const disconnected = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );
      const switched = await request(app.getHttpServer() as Server)
        .post('/api/auth/demo/switch')
        .auth(first.accessToken, { type: 'bearer' })
        .send({ userType: 'COMPANY' })
        .expect(200);
      await disconnected;
      first.accessToken = (
        switched.body as { accessToken: string }
      ).accessToken;
      first.cookie = switched.headers['set-cookie'][0].split(';')[0];
      const job = first.session.applications[0];
      await request(app.getHttpServer() as Server)
        .patch(`/api/job/applicants/${job.publicId}/status`)
        .auth(first.accessToken, { type: 'bearer' })
        .send({ status: 'ACCEPTED' })
        .expect(200);
      await request(app.getHttpServer() as Server)
        .patch(`/api/job/applicants/${job.publicId}/status`)
        .auth(first.accessToken, { type: 'bearer' })
        .send({ status: 'COMPLETED' })
        .expect(200);
      const back = await request(app.getHttpServer() as Server)
        .post('/api/auth/demo/switch')
        .auth(first.accessToken, { type: 'bearer' })
        .send({ userType: 'APPLICANT' })
        .expect(200);
      first.accessToken = (back.body as { accessToken: string }).accessToken;
      first.cookie = back.headers['set-cookie'][0].split(';')[0];
    } finally {
      socket.disconnect();
    }
  });
  it('returns 404 for every demo route when disabled before authentication or validation', async () => {
    const config = app.get(ConfigService);
    config.set('DEMO_ENABLED', 'false');
    try {
      await request(app.getHttpServer() as Server)
        .post('/api/auth/demo')
        .send({ userType: 'BAD' })
        .expect(404);
      await request(app.getHttpServer() as Server)
        .post('/api/auth/demo/switch')
        .send({})
        .expect(404);
      await request(app.getHttpServer() as Server)
        .get('/api/demo/session')
        .expect(404);
      await request(app.getHttpServer() as Server)
        .get('/api/job')
        .auth(first.accessToken, { type: 'bearer' })
        .expect(401);
    } finally {
      config.set('DEMO_ENABLED', 'true');
    }
  });
  it('records upload keys before signing, caps size and URL count', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/resume/upload-url')
      .auth(first.accessToken, { type: 'bearer' })
      .send({
        fileName: 'cv.pdf',
        contentType: 'application/pdf',
        fileSize: 5242881,
      })
      .expect(400);
    for (let i = 0; i < 3; i++)
      await request(app.getHttpServer() as Server)
        .post('/api/resume/upload-url')
        .auth(first.accessToken, { type: 'bearer' })
        .send({
          fileName: 'cv.pdf',
          contentType: 'application/pdf',
          fileSize: 2048,
        })
        .expect(201);
    await request(app.getHttpServer() as Server)
      .post('/api/resume/upload-url')
      .auth(first.accessToken, { type: 'bearer' })
      .send({
        fileName: 'cv.pdf',
        contentType: 'application/pdf',
        fileSize: 2048,
      })
      .expect(429);
    expect(
      await db.demoUpload.count({ where: { sessionId: first.session.id } }),
    ).toBe(3);
  });
  it('logout revokes both roles; expired refresh and HTTP never reopen a session', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/auth/logout')
      .auth(second.accessToken, { type: 'bearer' })
      .expect(204);
    await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth(second.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/refresh')
      .set('Cookie', second.cookie)
      .expect(401);
    await db.demoSession.update({
      where: { id: first.session.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await request(app.getHttpServer() as Server)
      .get('/api/demo/session')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/auth/refresh')
      .set('Cookie', first.cookie)
      .expect(401);
  });
  it('cleanup revokes first, waits for an active worker and removes queued work', async () => {
    const queue = app.get<Queue>(getQueueToken(QueueName.LlmEvaluation));
    const fresh = await create();
    const role = await request(app.getHttpServer() as Server)
      .post('/api/auth/demo/switch')
      .auth(fresh.accessToken, { type: 'bearer' })
      .send({ userType: 'APPLICANT' })
      .expect(200);
    const token = (role.body as { accessToken: string }).accessToken;
    const application = fresh.session.applications.find(
      (a) => a.isPrimaryApplicant,
    )!;
    let release!: (error: Error) => void;
    aiBlock = new Promise<never>((_, reject) => {
      release = reject;
    });
    const started = new Promise<void>((resolve) => {
      aiBlockStarted = resolve;
    });
    void aiBlock.catch(() => undefined);
    const evaluated = await request(app.getHttpServer() as Server)
      .post('/api/applicant-evaluation')
      .auth(token, { type: 'bearer' })
      .send({
        jobPublicId: application.jobPublicId,
        resumePublicId: application.resumePublicId,
      })
      .expect(201);
    const id = (evaluated.body as { publicId: string }).publicId;
    const waitState = async (wanted: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if ((await (await queue.getJob(id))?.getState()) === wanted) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Worker did not reach ${wanted}`);
    };
    try {
      await started;
      await waitState('active');
      await db.demoSession.update({
        where: { id: fresh.session.id },
        data: { expiresAt: new Date(0) },
      });
      await demo.cleanup();
      await request(app.getHttpServer() as Server)
        .get('/api/demo/session')
        .auth(token, { type: 'bearer' })
        .expect(401);
      expect(
        await db.user.count({ where: { demoSessionId: fresh.session.id } }),
      ).toBe(4);
      release(new Error('Controlled worker failure'));
      await waitState('failed');
      await demo.cleanup();
      expect(
        await db.user.count({ where: { demoSessionId: fresh.session.id } }),
      ).toBe(0);
    } finally {
      aiBlock = null;
      aiBlockStarted = undefined;
      release(new Error('Test cleanup'));
    }
    const pending = await create();
    const switched = await request(app.getHttpServer() as Server)
      .post('/api/auth/demo/switch')
      .auth(pending.accessToken, { type: 'bearer' })
      .send({ userType: 'APPLICANT' })
      .expect(200);
    const pendingToken = (switched.body as { accessToken: string }).accessToken;
    const pendingApplication = pending.session.applications.find(
      (a) => a.isPrimaryApplicant,
    )!;
    await queue.pause();
    try {
      const queued = await request(app.getHttpServer() as Server)
        .post('/api/applicant-evaluation')
        .auth(pendingToken, { type: 'bearer' })
        .send({
          jobPublicId: pendingApplication.jobPublicId,
          resumePublicId: pendingApplication.resumePublicId,
        })
        .expect(201);
      const queuedId = (queued.body as { publicId: string }).publicId;
      await db.demoSession.update({
        where: { id: pending.session.id },
        data: { expiresAt: new Date(0) },
      });
      await demo.cleanup();
      expect(await queue.getJob(queuedId)).toBeUndefined();
      expect(
        await db.user.count({ where: { demoSessionId: pending.session.id } }),
      ).toBe(0);
    } finally {
      await queue.resume();
    }
  }, 15000);
  it('cleanup makes progress past a full batch of waiting old workspaces', async () => {
    const blockers: string[] = [];
    for (let i = 0; i < 20; i++) {
      const session = await db.demoSession.create({
        data: {
          createdAt: new Date('2019-01-01'),
          expiresAt: new Date(0),
          ipHash: 'backlog-test',
        },
      });
      blockers.push(session.id);
      await db.demoUpload.create({
        data: {
          key: `backlog-test/${session.id}`,
          sessionId: session.id,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    }
    const newest = await db.demoSession.create({
      data: { expiresAt: new Date(0), ipHash: 'backlog-test' },
    });
    try {
      await demo.cleanup();
      await demo.cleanup();
      expect(
        (await db.demoSession.findUniqueOrThrow({ where: { id: newest.id } }))
          .cleanupStatus,
      ).toBe('DONE');
    } finally {
      await db.demoUpload.updateMany({
        where: { sessionId: { in: blockers } },
        data: { expiresAt: new Date(0) },
      });
      await demo.cleanup();
      await demo.cleanup();
    }
  });
  it('cleanup defers live upload URLs and retries storage failure without deleting samples/catalog', async () => {
    await demo.cleanup();
    expect(
      await db.user.count({ where: { demoSessionId: first.session.id } }),
    ).toBe(4);
    await db.demoUpload.updateMany({
      where: { sessionId: first.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    storageFailure = true;
    await demo.cleanup();
    expect(
      await db.user.count({ where: { demoSessionId: first.session.id } }),
    ).toBe(4);
    storageFailure = false;
    await Promise.all([demo.cleanup(), demo.cleanup()]);
    await demo.cleanup();
    expect(
      await db.user.count({ where: { demoSessionId: first.session.id } }),
    ).toBe(0);
    expect(deleted).toHaveLength(3);
    expect(deleted.some((key) => key.startsWith('demo/samples/'))).toBe(false);
    expect(await db.skill.count()).toBeGreaterThan(0);
  });
});
