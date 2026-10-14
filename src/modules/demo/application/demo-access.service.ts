import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JwtPayload,
  RequestWithUser,
} from 'src/shared/common/jwt.payload.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonUserRole } from 'src/shared/domain/enum';
import { IDemoRepository } from '../domain/demo.repo.interface';
import { demoConfig } from '../domain/demo-policy';

@Injectable()
export class DemoAccessService implements OnModuleDestroy {
  private readonly watchers = new Map<
    object,
    { sessionId: string; close: () => void }
  >();
  constructor(
    private readonly repo: IDemoRepository,
    private readonly config: ConfigService,
  ) {}
  get limits() {
    return demoConfig((key) => this.config.get<string>(key));
  }
  async authorize(payload: JwtPayload) {
    if (!payload.demoSessionId) {
      if (this.limits.only)
        throw new AppError(
          ErrorCode.Unauthorized,
          'Only demo sessions are allowed',
        );
      return;
    }
    if (!this.limits.enabled)
      throw new AppError(ErrorCode.Unauthorized, 'Demo is disabled');
    await this.repo.authorize(payload);
  }
  async authorizeHttp(request: RequestWithUser) {
    await this.authorize(request.user);
    if (!request.user.demoSessionId) return;
    await this.repo.rateLimit(request.user, this.limits.requestsPerMinute);
    const body = request.body as Record<string, unknown> | undefined;
    // Route params take precedence; client body cannot overwrite route ownership.
    for (const ids of [body, request.query, request.params])
      if (ids) await this.repo.authorizeResources(request.user, ids);
    const route = (request.route as { path?: string } | undefined)?.path;
    if (
      (request.method === 'POST' && route?.endsWith('/apply')) ||
      (request.method === 'POST' && route === '/api/applicant-evaluation')
    ) {
      if (request.user.role !== CommonUserRole.ROLE_APPLICANT)
        throw new AppError(
          ErrorCode.Forbidden,
          'Switch to the applicant role first',
        );
    }
  }
  invalidate(sessionId: string) {
    for (const watcher of [...this.watchers.values()])
      if (watcher.sessionId === sessionId) watcher.close();
  }
  watchSocket(
    socket: {
      disconnect(close: boolean): unknown;
      once(event: string, listener: () => void): unknown;
    },
    payload: JwtPayload & { exp?: number },
  ) {
    if (!payload.demoSessionId) return;
    const deadline = Math.min(
      payload.demoExpiresAt!,
      (payload.exp ?? Number.MAX_SAFE_INTEGER) * 1000,
    );
    const close = () => {
      stop();
      socket.disconnect(true);
    };
    const timeout = setTimeout(close, Math.max(0, deadline - Date.now()));
    timeout.unref();
    const interval = setInterval(() => {
      void this.authorize(payload).catch(close);
    }, 5000);
    interval.unref();
    const stop = () => {
      clearTimeout(timeout);
      clearInterval(interval);
      this.watchers.delete(socket);
    };
    socket.once('disconnect', stop);
    this.watchers.set(socket, { sessionId: payload.demoSessionId, close });
  }
  onModuleDestroy() {
    for (const watcher of [...this.watchers.values()]) watcher.close();
  }
}
