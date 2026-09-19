import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  SubscribeMessage,
  WsResponse,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { EventName } from '../constants/event-name';
import {
  ResumeIngestionNotificationDto,
  ResumeJoinDto,
  ResumeJoinResponseDto,
  ResumeLeaveDto,
} from '../payload/resume-event.dto';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';
import { IResumeContentRepository } from 'src/modules/resume/domain/repositories/resume-content.repo.interface';
import { RESUME_INGESTION_UPDATED_EVENT } from 'src/modules/resume/application/interfaces/resume-ingestion-notifier.interface';
import type { ResumeIngestionUpdatedEvent } from 'src/modules/resume/application/interfaces/resume-ingestion-notifier.interface';

type SocketData = { user?: JwtPayload };

export type ResumeIngestionSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;
@WebSocketGateway({
  namespace: '/resume',
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})
export class ResumeGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;
  constructor(
    private readonly jwtService: JwtService,
    private readonly resumeRepository: IResumeRepository,
    private readonly contentRepository: IResumeContentRepository,
  ) {}

  async handleConnection(client: ResumeIngestionSocket) {
    try {
      const token = client.handshake.auth.token as string;
      if (typeof token !== 'string' || !token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      client.data.user = {
        email: payload.email,
        sub: payload.sub,
        role: payload.role,
      };
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage(EventName.ResumeJoin)
  async handleResumeJoin(
    @ConnectedSocket() client: ResumeIngestionSocket,
    @MessageBody() data: ResumeJoinDto,
  ): Promise<WsResponse<ResumeJoinResponseDto>> {
    try {
      const user = client.data.user;
      if (!user) {
        return this.joinResponse(false);
      }

      const result = await this.resumeRepository.authorizeResume(
        data.resumePublicId,
        user.sub,
      );
      if (result.isErr() || !result.value) {
        return this.joinResponse(false);
      }

      await client.join(this.buildRoom(data.resumePublicId));
      const contentResult = await this.contentRepository.getCurrentForOwner(
        data.resumePublicId,
        user.sub,
      );
      if (contentResult.isErr()) {
        await client.leave(this.buildRoom(data.resumePublicId));
        return this.joinResponse(false);
      }

      return this.joinResponse(
        true,
        contentResult.value
          ? {
              resumePublicId: contentResult.value.resumePublicId,
              ingestionPublicId: contentResult.value.publicId,
              status: contentResult.value.status,
              ...(contentResult.value.errorMessage
                ? { errorMessage: contentResult.value.errorMessage }
                : undefined),
              updatedAt: contentResult.value.updatedAt.toISOString(),
            }
          : undefined,
      );
    } catch {
      return this.joinResponse(false);
    }
  }

  @SubscribeMessage(EventName.ResumeLeave)
  async handleResumeLeave(
    @ConnectedSocket() client: ResumeIngestionSocket,
    @MessageBody() data: ResumeLeaveDto,
  ): Promise<WsResponse<{ left: boolean }>> {
    try {
      if (!client.data.user) {
        return this.leaveResponse(false);
      }
      await client.leave(this.buildRoom(data.resumePublicId));
      return this.leaveResponse(true);
    } catch {
      return this.leaveResponse(false);
    }
  }

  @OnEvent(RESUME_INGESTION_UPDATED_EVENT)
  handleNotifyIngestionProcess(payload: ResumeIngestionUpdatedEvent) {
    this.server
      .to(this.buildRoom(payload.resumePublicId))
      .emit(EventName.IngestionProcessNotify, payload);
  }

  private joinResponse(
    joined: boolean,
    current?: ResumeIngestionNotificationDto,
  ): WsResponse<ResumeJoinResponseDto> {
    return {
      event: EventName.ResumeJoin,
      data: { joined, ...(current ? { current } : undefined) },
    };
  }

  private leaveResponse(left: boolean): WsResponse<{ left: boolean }> {
    return {
      event: EventName.ResumeLeave,
      data: { left },
    };
  }

  private buildRoom(resumePublicId: string): string {
    return `resume/${resumePublicId}`;
  }
}
