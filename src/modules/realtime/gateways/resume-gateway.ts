import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';

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
  constructor(private readonly jwtService: JwtService) {}
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
}
