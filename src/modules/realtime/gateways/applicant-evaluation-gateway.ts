import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { APPLICANT_EVALUATION_UPDATED_EVENT } from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-notifier.interface';
import type { ApplicantEvaluationUpdatedEvent } from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-notifier.interface';
import { IApplicantEvaluationRepository } from 'src/modules/applicant-evaluation/domain/repositories/applicant-evaluation.repo.interface';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { EventName } from '../constants/event-name';
import { EvaluationJoinEventDto } from '../payload/evaluation-event.dto';
import type { EvaluationJoinResponseDto } from '../payload/evaluation-event.dto';

type SocketData = { user?: JwtPayload };

export type ApplicantEvaluationSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

@WebSocketGateway({
  namespace: '/evaluation',
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})
export class ApplicantEvaluationGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly applicantEvaluationRepo: IApplicantEvaluationRepository,
  ) {}

  async handleConnection(client: ApplicantEvaluationSocket) {
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

  @SubscribeMessage(EventName.EvaluationJoin)
  async handleEvaluationJoin(
    @ConnectedSocket() client: ApplicantEvaluationSocket,
    @MessageBody() data: EvaluationJoinEventDto,
  ): Promise<WsResponse<EvaluationJoinResponseDto>> {
    try {
      const user = client.data.user;
      if (!user) {
        return this.joinResponse(false);
      }

      const authorized =
        await this.applicantEvaluationRepo.getRealtimeStateForApplicant(
          data.evaluationPublicId,
          user.sub,
        );
      if (authorized.isErr() || !authorized.value) {
        return this.joinResponse(false);
      }

      const room = this.buildRoom(data.evaluationPublicId);
      await client.join(room);

      // Read again after joining so an update cannot be lost between the
      // authorization query and room subscription.
      const current =
        await this.applicantEvaluationRepo.getRealtimeStateForApplicant(
          data.evaluationPublicId,
          user.sub,
        );
      if (current.isErr() || !current.value) {
        await client.leave(room);
        return this.joinResponse(false);
      }

      return this.joinResponse(true, {
        evaluationPublicId: current.value.evaluationPublicId,
        status: current.value.status,
        ...(current.value.overallScore !== null
          ? { overallScore: current.value.overallScore }
          : undefined),
        ...(current.value.errorMessage
          ? { errorMessage: current.value.errorMessage }
          : undefined),
        updatedAt: current.value.updatedAt.toISOString(),
      });
    } catch {
      return this.joinResponse(false);
    }
  }

  @OnEvent(APPLICANT_EVALUATION_UPDATED_EVENT)
  handleEvaluationScoreNotify(payload: ApplicantEvaluationUpdatedEvent) {
    this.server
      .to(this.buildRoom(payload.evaluationPublicId))
      .emit(EventName.EvaluationScoreNotify, payload);
  }

  private joinResponse(
    joined: boolean,
    current?: EvaluationJoinResponseDto['current'],
  ): WsResponse<EvaluationJoinResponseDto> {
    return {
      event: EventName.EvaluationJoin,
      data: { joined, ...(current ? { current } : undefined) },
    };
  }

  private buildRoom(evaluationPublicId: string): string {
    return `evaluation/${evaluationPublicId}`;
  }
}
