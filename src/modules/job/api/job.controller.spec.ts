import {
  type ExecutionContext,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { err, ok } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { JwtAuthGuard } from 'src/shared/common/jwt.guard';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { Roles } from 'src/shared/common/roles.decorator';
import { RolesGuard } from 'src/shared/common/roles.guard';
import {
  CommonJobApplicantStatus,
  CommonUserRole,
} from 'src/shared/domain/enum';
import { IArrangementService } from '../application/interfaces/arrangement.service.interface';
import { ICategoryService } from '../application/interfaces/category.service.interface';
import { IJobApplicantService } from '../application/interfaces/job-applicant.service.interface';
import { IJobService } from '../application/interfaces/job.service.interface';
import { JobController } from './job.controller';

function getUpdateStatusHandler(): JobController['updateJobApplicantStatus'] {
  return Reflect.get(JobController.prototype, 'updateJobApplicantStatus');
}

describe('JobController updateJobApplicantStatus', () => {
  const actorPublicId = randomUUID();
  const user: JwtPayload = {
    sub: actorPublicId,
    email: 'company@example.com',
    role: CommonUserRole.ROLE_COMPANY,
  };

  let jobApplicantService: { confirmJobApplicantAsync: jest.Mock };
  let controller: JobController;

  beforeEach(() => {
    jobApplicantService = {
      confirmJobApplicantAsync: jest.fn().mockResolvedValue(ok(undefined)),
    };
    controller = new JobController(
      {} as IJobService,
      jobApplicantService as unknown as IJobApplicantService,
      {} as ICategoryService,
      {} as IArrangementService,
    );
  });

  it('wires a PATCH endpoint to the application service', async () => {
    const result = await controller.updateJobApplicantStatus(
      user,
      'application-id',
      { status: CommonJobApplicantStatus.ACCEPTED },
    );

    expect(jobApplicantService.confirmJobApplicantAsync).toHaveBeenCalledWith(
      actorPublicId,
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );
    expect(result).toEqual({
      message: 'Job applicant status updated successfully',
    });

    const handler = getUpdateStatusHandler();
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'applicants/:jobApplicantPublicId/status',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
  });

  it('requires JWT authentication before the company role guard', () => {
    const handler = getUpdateStatusHandler();

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(new Reflector().get(Roles, handler)).toEqual([
      CommonUserRole.ROLE_COMPANY,
    ]);
  });

  it.each([
    [CommonUserRole.ROLE_COMPANY, true],
    [CommonUserRole.ROLE_APPLICANT, false],
  ])('allows company role only: %s', (role, allowed) => {
    const handler = getUpdateStatusHandler();
    const context = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext;
    const guard = new RolesGuard(new Reflector());

    if (allowed) {
      expect(guard.canActivate(context)).toBe(true);
    } else {
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('maps application errors to HTTP exceptions', async () => {
    jobApplicantService.confirmJobApplicantAsync.mockResolvedValue(
      err(new AppError(ErrorCode.Forbidden, 'Not job owner')),
    );

    await expect(
      controller.updateJobApplicantStatus(user, 'application-id', {
        status: CommonJobApplicantStatus.ACCEPTED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
