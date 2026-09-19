import { JwtService } from '@nestjs/jwt';
import type { UUID } from 'crypto';
import { err, ok } from 'neverthrow';
import { ApplicantEvaluationUpdatedEvent } from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-notifier.interface';
import { IApplicantEvaluationRepository } from 'src/modules/applicant-evaluation/domain/repositories/applicant-evaluation.repo.interface';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { CommonEvaluationStatus, CommonUserRole } from 'src/shared/domain/enum';
import { EventName } from '../constants/event-name';
import {
  ApplicantEvaluationGateway,
  ApplicantEvaluationSocket,
} from './applicant-evaluation-gateway';

describe('ApplicantEvaluationGateway', () => {
  const applicantPublicId: UUID = 'd3978c6a-d8f8-4e93-8658-d5a9a9872b52';
  const evaluationPublicId = '7c143f51-29dd-45d1-9d36-a5d780f5c843';
  const user: JwtPayload = {
    sub: applicantPublicId,
    email: 'applicant@example.com',
    role: CommonUserRole.ROLE_APPLICANT,
  };
  const currentState = {
    evaluationPublicId,
    status: CommonEvaluationStatus.COMPLETED,
    overallScore: 88,
    errorMessage: null,
    updatedAt: new Date('2026-09-19T00:01:00.000Z'),
  };

  let jwtService: { verifyAsync: jest.Mock };
  let repository: { getRealtimeStateForApplicant: jest.Mock };
  let gateway: ApplicantEvaluationGateway;

  const createSocket = (token?: string) => {
    const join = jest.fn().mockResolvedValue(undefined);
    const leave = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn();
    const client = {
      handshake: { auth: token ? { token } : {} },
      data: {},
      join,
      leave,
      disconnect,
    } as unknown as ApplicantEvaluationSocket;

    return { client, join, leave, disconnect };
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    repository = { getRealtimeStateForApplicant: jest.fn() };
    gateway = new ApplicantEvaluationGateway(
      jwtService as unknown as JwtService,
      repository as unknown as IApplicantEvaluationRepository,
    );
  });

  it('disconnects a client without a JWT', async () => {
    const { client, disconnect } = createSocket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('stores only the verified user claims needed by the gateway', async () => {
    const { client, disconnect } = createSocket('valid-token');
    jwtService.verifyAsync.mockResolvedValue({ ...user, extra: 'ignored' });

    await gateway.handleConnection(client);

    expect(client.data.user).toEqual(user);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('joins an owned evaluation and returns its current state', async () => {
    const { client, join } = createSocket('valid-token');
    client.data.user = user;
    repository.getRealtimeStateForApplicant.mockResolvedValue(ok(currentState));

    const response = await gateway.handleEvaluationJoin(client, {
      evaluationPublicId,
    });

    expect(repository.getRealtimeStateForApplicant).toHaveBeenCalledTimes(2);
    expect(repository.getRealtimeStateForApplicant).toHaveBeenCalledWith(
      evaluationPublicId,
      applicantPublicId,
    );
    expect(join).toHaveBeenCalledWith(`evaluation/${evaluationPublicId}`);
    expect(response).toEqual({
      event: EventName.EvaluationJoin,
      data: {
        joined: true,
        current: {
          evaluationPublicId,
          status: CommonEvaluationStatus.COMPLETED,
          overallScore: 88,
          updatedAt: '2026-09-19T00:01:00.000Z',
        },
      },
    });
  });

  it('does not join or disconnect a user who does not own the evaluation', async () => {
    const { client, join, disconnect } = createSocket('valid-token');
    client.data.user = user;
    repository.getRealtimeStateForApplicant.mockResolvedValue(ok(null));

    const response = await gateway.handleEvaluationJoin(client, {
      evaluationPublicId,
    });

    expect(response.data).toEqual({ joined: false });
    expect(join).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('leaves the room when the post-join state refresh fails', async () => {
    const { client, leave } = createSocket('valid-token');
    client.data.user = user;
    repository.getRealtimeStateForApplicant
      .mockResolvedValueOnce(ok(currentState))
      .mockResolvedValueOnce(err(new Error('database unavailable')));

    const response = await gateway.handleEvaluationJoin(client, {
      evaluationPublicId,
    });

    expect(leave).toHaveBeenCalledWith(`evaluation/${evaluationPublicId}`);
    expect(response.data).toEqual({ joined: false });
  });

  it('broadcasts an update only to the matching evaluation room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    const event: ApplicantEvaluationUpdatedEvent = {
      evaluationPublicId,
      status: CommonEvaluationStatus.COMPLETED,
      overallScore: 88,
      updatedAt: '2026-09-19T00:02:00.000Z',
    };

    gateway.handleEvaluationScoreNotify(event);

    expect(to).toHaveBeenCalledWith(`evaluation/${evaluationPublicId}`);
    expect(emit).toHaveBeenCalledWith(EventName.EvaluationScoreNotify, event);
  });
});
