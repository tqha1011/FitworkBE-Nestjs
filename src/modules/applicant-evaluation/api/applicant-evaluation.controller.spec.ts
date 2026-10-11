import {
  ForbiddenException,
  RequestMethod,
  type ExecutionContext,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { err, ok } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { JwtAuthGuard } from 'src/shared/common/jwt.guard';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { Roles } from 'src/shared/common/roles.decorator';
import { RolesGuard } from 'src/shared/common/roles.guard';
import { CommonUserRole } from 'src/shared/domain/enum';
import { IApplicantEvaluationService } from '../application/interfaces/applicant-evaluation.service.interface';
import { ApplicantEvaluationController } from './applicant-evaluation.controller';

describe('ApplicantEvaluationController job owner detail', () => {
  const user: JwtPayload = {
    sub: 'owner-id',
    email: 'owner@example.test',
    role: CommonUserRole.ROLE_COMPANY,
  };
  const detail = {
    publicId: 'evaluation-id',
    overallScore: 42,
    scoreBreakdown: {
      schemaVersion: 2,
      criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
    },
    evidence: {
      schemaVersion: 2,
      strengths: ['TypeScript'],
      gaps: [],
      explanation: 'Relevant skill found.',
      criteria: [],
    },
    decisionSupportOnly: true,
    resumeRedaction: {
      redactedResumeText: 'TypeScript',
      redactedResumeVersion: 'resume-redaction-v1',
    },
    metadata: {
      jobContentHash: 'job-hash',
      resumeContentHash: 'resume-hash',
      redactedResumeHash: 'redacted-hash',
      parserVersion: 'parser-v1',
      redactionVersion: 'resume-redaction-v1',
      model: 'gemini-model',
      promptVersion: 'applicant-match-v2',
    },
  };
  let service: {
    getApplicantEvaluationForJobOwnerAsync: jest.Mock;
    getApplicantEvaluationDetailAsync: jest.Mock;
  };
  let controller: ApplicantEvaluationController;

  beforeEach(() => {
    service = {
      getApplicantEvaluationForJobOwnerAsync: jest
        .fn()
        .mockResolvedValue(ok(detail)),
      getApplicantEvaluationDetailAsync: jest
        .fn()
        .mockResolvedValue(ok(detail)),
    };
    controller = new ApplicantEvaluationController(
      service as unknown as IApplicantEvaluationService,
    );
  });

  it('wires a company-only GET route to the owner service', async () => {
    expect(
      await controller.getApplicantEvaluationForJobOwner(
        user,
        'job-id',
        'evaluation-id',
      ),
    ).toEqual(detail);
    expect(service.getApplicantEvaluationForJobOwnerAsync).toHaveBeenCalledWith(
      'owner-id',
      'job-id',
      'evaluation-id',
    );

    const handler = Reflect.get(
      ApplicantEvaluationController.prototype,
      'getApplicantEvaluationForJobOwner',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'jobs/:jobPublicId/:evaluationPublicId',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(new Reflector().get(Roles, handler)).toEqual([
      CommonUserRole.ROLE_COMPANY,
    ]);
  });

  it('rejects an applicant role on the owner route', () => {
    const handler = Reflect.get(
      ApplicantEvaluationController.prototype,
      'getApplicantEvaluationForJobOwner',
    );
    const context = {
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: CommonUserRole.ROLE_APPLICANT } }),
      }),
    } as unknown as ExecutionContext;

    expect(() => new RolesGuard(new Reflector()).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('maps owner service errors to HTTP exceptions', async () => {
    service.getApplicantEvaluationForJobOwnerAsync.mockResolvedValue(
      err(new AppError(ErrorCode.Forbidden, 'Not job owner')),
    );

    await expect(
      controller.getApplicantEvaluationForJobOwner(
        user,
        'job-id',
        'evaluation-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps the applicant route wired to applicant ownership checks', async () => {
    await controller.getApplicantEvaluationDetail(user, 'job-id');

    expect(service.getApplicantEvaluationDetailAsync).toHaveBeenCalledWith(
      'owner-id',
      'job-id',
    );
    const handler = Reflect.get(
      ApplicantEvaluationController.prototype,
      'getApplicantEvaluationDetail',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':jobPublicId');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(new Reflector().get(Roles, handler)).toEqual([
      CommonUserRole.ROLE_APPLICANT,
      CommonUserRole.ROLE_COMPANY,
    ]);
  });
});
