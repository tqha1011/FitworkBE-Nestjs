import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { hash } from 'bcrypt';
import { UserType } from 'generated/prisma/enums';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { AuthTokens } from 'src/modules/auth/application/interfaces/auth.service.interface';
import { demoCandidates } from '../domain/demo-fixtures';
import {
  DemoLoginState,
  IDemoRepository,
  IDemoCleanup,
} from '../domain/demo.repo.interface';
import { hashDemoIp } from '../domain/demo-policy';
import { demoMetrics } from '../domain/demo-metrics';
import { DemoAccessService } from './demo-access.service';

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoService.name);
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly repo: IDemoRepository,
    private readonly access: DemoAccessService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly storage: IFileStorage,
    private readonly cleaner: IDemoCleanup,
  ) {}
  get enabled() {
    return this.access.limits.enabled;
  }
  private token() {
    const raw = randomBytes(32).toString('hex');
    return { raw, hash: this.hash(raw) };
  }
  private hash(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }
  private async result<T>(
    operation: () => Promise<T>,
  ): Promise<Result<T, AppError>> {
    try {
      return ok(await operation());
    } catch (error) {
      if (error instanceof AppError) return err(error);
      this.logger.error('demo.operation.failed');
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Demo service is temporarily unavailable',
        ),
      );
    }
  }
  private requireEnabled() {
    if (!this.enabled)
      throw new AppError(ErrorCode.NotFound, 'Demo is disabled');
  }
  private async tokens(
    state: DemoLoginState,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const expiresIn = Math.min(
      Number(this.config.get('JWT_ACCESS_EXPIRES_IN_SECONDS', '900')),
      Math.floor((state.expiresAt.getTime() - Date.now()) / 1000),
    );
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1)
      throw new AppError(
        ErrorCode.Unauthorized,
        'Demo expired — Start new demo',
      );
    const accessToken = await this.jwt.signAsync(
      {
        sub: state.user.publicId,
        email: state.user.email,
        role: state.user.role,
        demoSessionId: state.id,
        demoExpiresAt: state.expiresAt.getTime(),
        demoGeneration: state.generation,
      },
      { expiresIn },
    );
    return {
      accessToken,
      accessTokenExpiresIn: expiresIn,
      refreshToken,
      refreshTokenExpiresAt: state.expiresAt,
    };
  }
  create(ip: string, userType: UserType = 'COMPANY') {
    return this.result(async () => {
      this.requireEnabled();
      const sizes = [];
      for (const candidate of demoCandidates) {
        const asset = await this.storage.getObjectMetadata(
          `demo/samples/v1/${candidate.key}.pdf`,
        );
        if (
          asset.isErr() ||
          !asset.value ||
          asset.value.contentType !== 'application/pdf' ||
          asset.value.contentLength < 1
        )
          throw new AppError(
            ErrorCode.InternalServerError,
            'Demo sample CV assets are not ready',
          );
        sizes.push(asset.value.contentLength);
      }
      const token = this.token();
      const passwordHashed = await hash(randomBytes(32).toString('hex'), 10);
      const state = await this.repo.create(
        hashDemoIp(ip, this.config.getOrThrow('JWT_SECRET')),
        userType,
        token.hash,
        passwordHashed,
        sizes,
        this.access.limits,
      );
      this.logger.log('demo.workspace.created');
      demoMetrics.workspace('created');
      return this.tokens(state, token.raw);
    });
  }
  switchRole(payload: JwtPayload, userType: UserType) {
    return this.result(async () => {
      this.requireEnabled();
      if (!payload.demoSessionId)
        throw new AppError(
          ErrorCode.Unauthorized,
          'A demo session is required',
        );
      const token = this.token();
      const state = await this.repo.switchRole(payload, userType, token.hash);
      this.access.invalidate(state.id);
      return this.tokens(state, token.raw);
    });
  }
  refresh(raw: string) {
    return this.result(async () => {
      this.requireEnabled();
      const next = this.token();
      const state = await this.repo.refresh(this.hash(raw), next.hash);
      return this.tokens(state, next.raw);
    });
  }
  logout(bearer?: string, raw?: string) {
    return this.result(async () => {
      let payload: JwtPayload | undefined;
      if (bearer) {
        try {
          payload = await this.jwt.verifyAsync<JwtPayload>(bearer);
        } catch {
          throw new AppError(
            ErrorCode.Unauthorized,
            'Demo expired — Start new demo',
          );
        }
      }
      if (payload && !payload.demoSessionId)
        throw new AppError(
          ErrorCode.Unauthorized,
          'A demo session is required',
        );
      await this.repo.revoke(payload, raw ? this.hash(raw) : undefined);
      if (payload?.demoSessionId) this.access.invalidate(payload.demoSessionId);
    });
  }
  view(payload: JwtPayload) {
    return this.result(async () => {
      this.requireEnabled();
      const view = await this.repo.view(payload, this.access.limits);
      const available =
        !!this.config.get<string>('LLM_EVALUATION_KEY')?.trim() &&
        !!this.config.get<string>('LLM_EVALUATION_MODEL')?.trim();
      view.ai.available = available && view.ai.remaining > 0;
      view.ai.unavailableReason = !available
        ? 'Live AI is not configured. Sample results remain available.'
        : view.ai.remaining === 0
          ? 'Demo AI quota exhausted. Sample results remain available.'
          : null;
      return view;
    });
  }
  cleanup() {
    return this.cleaner.run();
  }
  onModuleInit() {
    if (this.enabled) {
      this.timer = setInterval(() => {
        void this.cleanup().catch(() =>
          this.logger.error('demo.cleanup.failed'),
        );
      }, 600000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
