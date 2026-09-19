import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WsResponse,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { EventName } from '../constants/event-name';
import { ResumeJoinDto, ResumeLeaveDto } from '../payload/resume-event.dto';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';

type SocketData = { user: JwtPayload };

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
export class ResumeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;
  constructor(
    private readonly jwtService: JwtService,
    private readonly resumeRepository: IResumeRepository,
  ) {}
  handleDisconnect(client: ResumeIngestionSocket) {
    client.disconnect(true);
  }

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
      await client.join(`user/${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage(EventName.ResumeJoin)
  async handleResumeJoin(
    client: ResumeIngestionSocket,
    data: ResumeJoinDto,
  ): Promise<WsResponse<{ joined: boolean }>> {
    try {
      const result = await this.resumeRepository.authorizeResume(
        data.resumePublicId,
        client.data.user.sub,
      );
      if (result.isErr() || !result.value) {
        return {
          event: EventName.ResumeJoin,
          data: { joined: false },
        };
      }
      await client.join(this.buildRoom(data.resumePublicId));
      return {
        event: EventName.ResumeJoin,
        data: { joined: true },
      };
    } catch {
      return {
        event: EventName.ResumeJoin,
        data: { joined: false },
      };
    }
  }

  @SubscribeMessage(EventName.ResumeLeave)
  async handleResumeLeave(
    client: ResumeIngestionSocket,
    data: ResumeLeaveDto,
  ): Promise<WsResponse<{ left: boolean }>> {
    try {
      await client.leave(this.buildRoom(data.resumePublicId));
      return {
        event: EventName.ResumeLeave,
        data: { left: true },
      };
    } catch {
      return {
        event: EventName.ResumeLeave,
        data: { left: false },
      };
    }
  }

  private buildRoom(resumePublicId: string): string {
    return `resume/${resumePublicId}`;
  }
}
