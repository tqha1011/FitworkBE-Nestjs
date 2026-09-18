import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { ok } from 'neverthrow';
import { Socket } from 'socket.io';
import {
  CommonFileType,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import { IResumeContentRepository } from '../domain/repositories/resume-content.repo.interface';
import { ResumeIngestionGateway } from './resume-ingestion.gateway';

describe('ResumeIngestionGateway', () => {
  const user = {
    sub: 'owner-id',
    email: 'owner@example.com',
    role: 'ROLE_APPLICANT',
  };
  let jwtService: { verifyAsync: jest.Mock };
  let contentRepository: { getCurrentForOwner: jest.Mock };
  let gateway: ResumeIngestionGateway;

  const socket = (token?: string) => {
    const disconnect = jest.fn();
    const join = jest.fn().mockResolvedValue(undefined);
    const client = {
      handshake: { auth: token ? { token } : {} },
      data: {},
      disconnect,
      join,
    } as unknown as Socket;
    return { client, disconnect, join };
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    contentRepository = { getCurrentForOwner: jest.fn() };
    gateway = new ResumeIngestionGateway(
      jwtService as unknown as JwtService,
      contentRepository as unknown as IResumeContentRepository,
    );
  });

  it('disconnects a client without a JWT', async () => {
    const { client, disconnect } = socket();

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('disconnects a client with an invalid JWT', async () => {
    const { client, disconnect } = socket('bad-token');
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('checks ownership, joins the room and acknowledges current state', async () => {
    const { client, join } = socket('valid-token');
    jwtService.verifyAsync.mockResolvedValue(user);
    await gateway.handleConnection(client);
    contentRepository.getCurrentForOwner.mockResolvedValue(
      ok({
        id: 1,
        publicId: 'content-id',
        resumeId: 2,
        resumePublicId: 'resume-id',
        ownerPublicId: user.sub,
        status: CommonResumeIngestionStatus.PROCESSING,
        errorMessage: null,
        storagePath: 'path',
        fileSize: 1,
        fileType: CommonFileType.PDF,
        fileName: 'Resume.pdf',
        parserVersion: 'pdf-parse@2.4.5/text-v1',
        extractedText: null,
        contentHash: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    );

    const response = await gateway.subscribe(client, {
      resumePublicId: 'resume-id',
    });

    expect(contentRepository.getCurrentForOwner).toHaveBeenCalledWith(
      'resume-id',
      user.sub,
    );
    expect(join).toHaveBeenCalledWith('resume:resume-id');
    expect(response).toEqual({
      resumePublicId: 'resume-id',
      ingestionPublicId: 'content-id',
      status: CommonResumeIngestionStatus.PROCESSING,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('rejects a subscription when ownership cannot be established', async () => {
    const { client } = socket('valid-token');
    jwtService.verifyAsync.mockResolvedValue(user);
    await gateway.handleConnection(client);
    contentRepository.getCurrentForOwner.mockResolvedValue(ok(null));

    await expect(
      gateway.subscribe(client, { resumePublicId: 'another-resume' }),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('broadcasts status updates to the resume room', async () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    Object.defineProperty(gateway, 'server', { value: { to } });
    const event = {
      resumePublicId: 'resume-id',
      ingestionPublicId: 'content-id',
      status: CommonResumeIngestionStatus.COMPLETED,
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    await gateway.notify(event);

    expect(to).toHaveBeenCalledWith('resume:resume-id');
    expect(emit).toHaveBeenCalledWith('resume.ingestion.updated', event);
  });
});
