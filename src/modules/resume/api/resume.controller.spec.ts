import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { err, ok } from 'neverthrow';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonUserRole } from 'src/shared/domain/enum';
import { IResumeService } from '../application/interfaces/resume.service.interface';
import { ResumeController } from './resume.controller';

describe('Resume read endpoints', () => {
  const ownerId = '8c6cf582-9a29-48ed-a31f-93f9d78bb701';
  const resumeId = 'b1ad7d9d-8c47-4fd3-b70b-c7d25b109e21';
  const detail = {
    publicId: resumeId,
    fileName: 'Backend CV',
    fileType: 'pdf',
    fileSize: 512,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ingestionPublicId: null,
    ingestionStatus: null,
  };
  const page = {
    items: [detail],
    totalPages: 1,
    pageNumber: 1,
    pageSize: 20,
    hasPrevious: false,
    hasNext: false,
  };
  let app: INestApplication;
  let token: string;
  let service: {
    getResumesAsync: jest.Mock;
    getResumeDetailAsync: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getResumesAsync: jest.fn().mockResolvedValue(ok(page)),
      getResumeDetailAsync: jest.fn().mockResolvedValue(ok(detail)),
    };
    const jwt = new JwtService({ secret: 'resume-read-test-secret' });
    token = jwt.sign({ sub: ownerId, role: CommonUserRole.ROLE_APPLICANT });
    const module = await Test.createTestingModule({
      controllers: [ResumeController],
      providers: [
        { provide: IResumeService, useValue: service },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the JWT owner resumes with default pagination', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/resume')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual(page);
    expect(service.getResumesAsync).toHaveBeenCalledWith(ownerId, {
      pageNumber: 1,
      pageSize: 20,
    });
  });

  it('parses pagination and ignores a client-supplied owner', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/resume?pageNumber=2&pageSize=100&userPublicId=other-user')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(service.getResumesAsync).toHaveBeenCalledWith(ownerId, {
      pageNumber: 2,
      pageSize: 100,
    });
  });

  it.each([
    'pageNumber=0',
    'pageNumber=-1',
    'pageNumber=1.5',
    'pageNumber=text',
    'pageSize=0',
    'pageSize=-1',
    'pageSize=1.5',
    'pageSize=text',
    'pageSize=101',
  ])(
    'rejects invalid pagination %s before calling the service',
    async (query) => {
      await request(app.getHttpServer() as Server)
        .get(`/api/resume?${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(service.getResumesAsync).not.toHaveBeenCalled();
    },
  );

  it('gets detail using the resume public ID and JWT owner', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`/api/resume/${resumeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual(detail);
    expect(service.getResumeDetailAsync).toHaveBeenCalledWith(
      ownerId,
      resumeId,
    );
  });

  it('rejects an invalid resume UUID', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/resume/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(service.getResumeDetailAsync).not.toHaveBeenCalled();
  });

  it.each(['/api/resume', `/api/resume/${resumeId}`])(
    'requires authentication for %s',
    async (path) => {
      await request(app.getHttpServer() as Server)
        .get(path)
        .expect(401);
      await request(app.getHttpServer() as Server)
        .get(path)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
      expect(service.getResumesAsync).not.toHaveBeenCalled();
      expect(service.getResumeDetailAsync).not.toHaveBeenCalled();
    },
  );

  it.each([
    [ErrorCode.NotFound, 404],
    [ErrorCode.InternalServerError, 500],
  ])('maps detail error %s to HTTP %s', async (code, status) => {
    service.getResumeDetailAsync.mockResolvedValue(
      err(new AppError(code, 'Failed to get resume')),
    );
    await request(app.getHttpServer() as Server)
      .get(`/api/resume/${resumeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(status);
  });

  it('maps a list repository error to HTTP 500', async () => {
    service.getResumesAsync.mockResolvedValue(
      err(new AppError(ErrorCode.InternalServerError, 'Failed to get resumes')),
    );
    await request(app.getHttpServer() as Server)
      .get('/api/resume')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);
  });

  it('documents the paginated list, detail and nullable ingestion fields', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Resume')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    const list = document.paths['/api/resume']?.get;
    const detailOperation = document.paths['/api/resume/{resumePublicId}']?.get;
    const listResponse = list?.responses['200'];
    if (!listResponse || '$ref' in listResponse) {
      throw new Error('Missing list response schema');
    }
    const listSchema = listResponse.content?.['application/json']?.schema;
    expect(
      listSchema && 'properties' in listSchema
        ? listSchema.properties?.items
        : undefined,
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ResumeReadResponseDto' },
    });
    expect(detailOperation?.responses['200']).toBeDefined();
    expect(detailOperation?.responses['404']).toBeDefined();
    const schema = document.components?.schemas?.ResumeReadResponseDto;
    if (!schema || '$ref' in schema) {
      throw new Error('Missing resume schema');
    }
    expect(schema.properties?.ingestionPublicId).toMatchObject({
      nullable: true,
    });
    expect(schema.properties?.ingestionStatus).toMatchObject({
      nullable: true,
    });
    const pageSize = list?.parameters?.find(
      (parameter) => 'name' in parameter && parameter.name === 'pageSize',
    );
    expect(
      pageSize && 'schema' in pageSize ? pageSize.schema : undefined,
    ).toMatchObject({
      default: 20,
      minimum: 1,
      maximum: 100,
    });
  });
});
