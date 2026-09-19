import {
  CallHandler,
  ExecutionContext,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

export class WsLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WsLoggingInterceptor.name);
  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> {
    const start = Date.now();
    const pattern = context.switchToWs().getPattern();
    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        this.logger.log(
          `WebSocket event ${pattern} processed in ${duration}ms`,
        );
      }),
    );
  }
}
