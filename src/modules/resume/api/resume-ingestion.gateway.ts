import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { IResumeIngestionNotifier } from '../application/interfaces/resume-ingestion-notifier.interface';
import { IResumeContentRepository } from '../domain/repositories/resume-content.repo.interface';

type SocketData = { user?: JwtPayload };

@WebSocketGateway({
  namespace: '/resume',
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})
export class ResumeIngestionGateway
  implements OnGatewayConnection, IResumeIngestionNotifier
{
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly contentRepository: IResumeContentRepository,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const auth = client.handshake.auth as Record<string, unknown>;
    const token = auth.token;
    if (typeof token !== 'string' || !token) {
      client.disconnect(true);
      return;
    }

    try {
      (client.data as SocketData).user =
        await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('resume.ingestion.subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { resumePublicId?: string },
  ) {
    const user = (client.data as SocketData).user;
    if (!user) {
      throw new WsException('Unauthorized');
    }
    if (!body?.resumePublicId) {
      throw new WsException('resumePublicId is required');
    }

    const contentResult = await this.contentRepository.getCurrentForOwner(
      body.resumePublicId,
      user.sub,
    );
    if (contentResult.isErr()) {
      throw new WsException('Failed to load resume ingestion status');
    }
    if (!contentResult.value) {
      throw new WsException('Resume not found or access denied');
    }

    await client.join(this.room(body.resumePublicId));
    return {
      resumePublicId: contentResult.value.resumePublicId,
      ingestionPublicId: contentResult.value.publicId,
      status: contentResult.value.status,
      ...(contentResult.value.errorMessage
        ? { errorMessage: contentResult.value.errorMessage }
        : undefined),
      updatedAt: contentResult.value.updatedAt.toISOString(),
    };
  }

  notify(
    event: Parameters<IResumeIngestionNotifier['notify']>[0],
  ): Promise<void> {
    this.server
      .to(this.room(event.resumePublicId))
      .emit('resume.ingestion.updated', event);
    return Promise.resolve();
  }

  private room(resumePublicId: string): string {
    return `resume:${resumePublicId}`;
  }
}
