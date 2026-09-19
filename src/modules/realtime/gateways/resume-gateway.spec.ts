import { JwtService } from '@nestjs/jwt';
import type { UUID } from 'crypto';
import { err, ok } from 'neverthrow';
import { IResumeContentRepository } from 'src/modules/resume/domain/repositories/resume-content.repo.interface';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import {
  CommonFileType,
  CommonResumeIngestionStatus,
  CommonUserRole,
} from 'src/shared/domain/enum';
import { EventName } from '../constants/event-name';
import { ResumeGateway, ResumeIngestionSocket } from './resume-gateway';

describe('ResumeGateway', () => {
  const ownerPublicId: UUID = 'd3978c6a-d8f8-4e93-8658-d5a9a9872b52';
  const resumePublicId = '7c143f51-29dd-45d1-9d36-a5d780f5c843';
  const ingestionPublicId = 'aee177b4-9d37-47e5-a037-b7bbb93b7f89';
  const user: JwtPayload = {
    sub: ownerPublicId,
    email: 'owner@example.com',
    role: CommonUserRole.ROLE_APPLICANT,
  };
  let jwtService: { verifyAsync: jest.Mock };
  let resumeRepository: { authorizeResume: jest.Mock };
  let contentRepository: { getCurrentForOwner: jest.Mock };
  let gateway: ResumeGateway;

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
    } as unknown as ResumeIngestionSocket;

    return { client, join, leave, disconnect };
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    resumeRepository = { authorizeResume: jest.fn() };
    contentRepository = { getCurrentForOwner: jest.fn() };
    gateway = new ResumeGateway(
      jwtService as unknown as JwtService,
      resumeRepository as unknown as IResumeRepository,
      contentRepository as unknown as IResumeContentRepository,
    );
  });

  it('disconnects a client without a JWT', async () => {
    const { client, disconnect } = createSocket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('stores the verified user on the socket', async () => {
    const { client, disconnect } = createSocket('valid-token');
    jwtService.verifyAsync.mockResolvedValue(user);

    await gateway.handleConnection(client);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
    expect(client.data.user).toEqual(user);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('joins an owned resume and returns its current ingestion state', async () => {
    const { client, join } = createSocket('valid-token');
    client.data.user = user;
    resumeRepository.authorizeResume.mockResolvedValue(ok(true));
    contentRepository.getCurrentForOwner.mockResolvedValue(
      ok({
        id: 1,
        publicId: ingestionPublicId,
        resumeId: 2,
        resumePublicId,
        ownerPublicId,
        status: CommonResumeIngestionStatus.PROCESSING,
        errorMessage: null,
        storagePath: 'resume/cv.pdf',
        fileSize: 10,
        fileType: CommonFileType.PDF,
        fileName: 'cv.pdf',
        extractedText: null,
        contentHash: null,
        parserVersion: 'pdf-v1',
        startedAt: new Date('2026-09-19T00:00:00.000Z'),
        completedAt: null,
        createdAt: new Date('2026-09-19T00:00:00.000Z'),
        updatedAt: new Date('2026-09-19T00:01:00.000Z'),
      }),
    );

    const response = await gateway.handleResumeJoin(client, {
      resumePublicId,
    });

    expect(resumeRepository.authorizeResume).toHaveBeenCalledWith(
      resumePublicId,
      ownerPublicId,
    );
    expect(join).toHaveBeenCalledWith(`resume/${resumePublicId}`);
    expect(join.mock.invocationCallOrder[0]).toBeLessThan(
      contentRepository.getCurrentForOwner.mock.invocationCallOrder[0],
    );
    expect(response).toEqual({
      event: EventName.ResumeJoin,
      data: {
        joined: true,
        current: {
          resumePublicId,
          ingestionPublicId,
          status: CommonResumeIngestionStatus.PROCESSING,
          updatedAt: '2026-09-19T00:01:00.000Z',
        },
      },
    });
  });

  it('rejects a resume room when the user is not its owner', async () => {
    const { client, join } = createSocket('valid-token');
    client.data.user = user;
    resumeRepository.authorizeResume.mockResolvedValue(ok(false));

    const response = await gateway.handleResumeJoin(client, {
      resumePublicId,
    });

    expect(response).toEqual({
      event: EventName.ResumeJoin,
      data: { joined: false },
    });
    expect(join).not.toHaveBeenCalled();
    expect(contentRepository.getCurrentForOwner).not.toHaveBeenCalled();
  });

  it('leaves the room if the current status cannot be loaded', async () => {
    const { client, leave } = createSocket('valid-token');
    client.data.user = user;
    resumeRepository.authorizeResume.mockResolvedValue(ok(true));
    contentRepository.getCurrentForOwner.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const response = await gateway.handleResumeJoin(client, {
      resumePublicId,
    });

    expect(leave).toHaveBeenCalledWith(`resume/${resumePublicId}`);
    expect(response.data).toEqual({ joined: false });
  });

  it('leaves an explicitly requested resume room', async () => {
    const { client, leave } = createSocket('valid-token');
    client.data.user = user;

    const response = await gateway.handleResumeLeave(client, {
      resumePublicId,
    });

    expect(leave).toHaveBeenCalledWith(`resume/${resumePublicId}`);
    expect(response).toEqual({
      event: EventName.ResumeLeave,
      data: { left: true },
    });
  });

  it('broadcasts ingestion updates only to the matching resume room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', {
      value: { to },
    });
    const event = {
      resumePublicId,
      ingestionPublicId,
      status: CommonResumeIngestionStatus.COMPLETED,
      updatedAt: '2026-09-19T00:02:00.000Z',
    };

    gateway.handleNotifyIngestionProcess(event);

    expect(to).toHaveBeenCalledWith(`resume/${resumePublicId}`);
    expect(emit).toHaveBeenCalledWith(EventName.IngestionProcessNotify, event);
  });
});
