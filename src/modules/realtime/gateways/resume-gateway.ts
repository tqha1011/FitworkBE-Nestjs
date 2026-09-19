import { JwtService } from '@nestjs/jwt';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';

type SocketData = { user: JwtPayload };
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
  constructor(private readonly jwtService: JwtService) {}

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
}
