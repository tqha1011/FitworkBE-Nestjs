import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApplicantEvaluationController } from 'src/modules/applicant-evaluation/api/applicant-evaluation.controller';
import { IApplicantEvaluationService } from 'src/modules/applicant-evaluation/application/interfaces/applicant-evaluation.service.interface';
import { AuthController } from 'src/modules/auth/api/auth.controller';
import { IAuthService } from 'src/modules/auth/application/interfaces/auth.service.interface';
import { ArrangementController } from 'src/modules/job/api/arrangment.controller';
import { CategoryController } from 'src/modules/job/api/category.controller';
import { JobController } from 'src/modules/job/api/job.controller';
import { SkillController } from 'src/modules/job/api/skill.controller';
import { IArrangementService } from 'src/modules/job/application/interfaces/arrangement.service.interface';
import { ICategoryService } from 'src/modules/job/application/interfaces/category.service.interface';
import { IJobApplicantService } from 'src/modules/job/application/interfaces/job-applicant.service.interface';
import { IJobService } from 'src/modules/job/application/interfaces/job.service.interface';
import { ISkillService } from 'src/modules/job/application/interfaces/skill.service.interface';
import { ResumeController } from 'src/modules/resume/api/resume.controller';
import { IResumeService } from 'src/modules/resume/application/interfaces/resume.service.interface';

describe('Swagger response documentation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ApplicantEvaluationController,
        AuthController,
        ResumeController,
        JobController,
        CategoryController,
        ArrangementController,
        SkillController,
      ],
      providers: [
        IApplicantEvaluationService,
        IAuthService,
        IResumeService,
        IJobService,
        IJobApplicantService,
        ICategoryService,
        IArrangementService,
        ISkillService,
      ]
        .map((provide) => ({ provide, useValue: {} }))
        .concat([{ provide: JwtService, useValue: {} }]),
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('publishes real response bodies for V1/V2 evaluation and owner APIs', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Fitwork').setVersion('1').build(),
    );
    const applicant = document.paths[
      '/api/applicant-evaluation/{evaluationPublicId}'
    ]?.get?.responses?.['200'] as {
      content?: Record<string, { schema?: { oneOf?: unknown[] } }>;
    };
    const owner = document.paths[
      '/api/applicant-evaluation/jobs/{jobPublicId}/{evaluationPublicId}'
    ]?.get?.responses?.['200'] as {
      content?: Record<string, { schema?: { oneOf?: unknown[] } }>;
    };
    const queued = document.paths['/api/applicant-evaluation']?.post
      ?.responses?.['201'] as {
      content?: Record<
        string,
        { schema?: { properties?: Record<string, unknown> } }
      >;
    };

    expect(applicant.content?.['application/json']?.schema?.oneOf).toHaveLength(
      2,
    );
    expect(owner.content?.['application/json']?.schema?.oneOf).toHaveLength(2);
    expect(owner.content?.['application/json']?.schema?.oneOf?.[1]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          decisionSupportOnly: expect.any(Object) as object,
          resumeRedaction: expect.any(Object) as object,
          metadata: expect.any(Object) as object,
        }) as object,
      }),
    );
    expect(
      queued.content?.['application/json']?.schema?.properties,
    ).toHaveProperty('publicId');
  });

  it('publishes success status and schemas for the other controllers', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Fitwork').setVersion('1').build(),
    );
    expect(
      document.paths['/api/auth/register']?.post?.responses?.['201'],
    ).toBeDefined();
    expect(
      document.paths['/api/auth/logout']?.post?.responses?.['204'],
    ).toBeDefined();
    expect(
      document.paths['/api/resume/upload-url']?.post?.responses?.['201'],
    ).toBeDefined();
    expect(
      document.paths['/api/resume/{resumePublicId}/download-url']?.get
        ?.responses?.['200'],
    ).toBeDefined();
    expect(document.paths['/api/job']?.get?.responses?.['200']).toBeDefined();
    expect(
      document.paths['/api/job/applied']?.get?.responses?.['200'],
    ).toBeDefined();
    expect(
      document.paths['/api/categories']?.get?.responses?.['200'],
    ).toBeDefined();
    expect(
      document.paths['/api/arrangements']?.get?.responses?.['200'],
    ).toBeDefined();
    expect(
      document.paths['/api/skills']?.get?.responses?.['200'],
    ).toBeDefined();

    const jobSearch = document.paths['/api/job']?.get?.responses?.['200'] as {
      content?: Record<
        string,
        { schema?: { properties?: Record<string, unknown> } }
      >;
    };
    expect(
      jobSearch.content?.['application/json']?.schema?.properties,
    ).toHaveProperty('items');
    expect(document.components?.schemas?.JobItemResponseDto).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          skills: expect.any(Object) as object,
          category: expect.any(Object) as object,
        }) as object,
      }),
    );
    expect(document.components?.schemas?.ResumeResponseDto).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          ingestionStatus: expect.any(Object) as object,
        }) as object,
      }),
    );
  });
});
