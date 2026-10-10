import { err, ok } from 'neverthrow';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { ErrorCode } from 'src/shared/common/errorCode';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';
import { IJobRepository } from '../../domain/repositories/job.repo.interface';
import { IJobApplicantRepository } from '../../domain/repositories/job-applicant.repo.interface';
import { JobApplicantService } from './job-applicant.service';

describe('JobApplicantService confirmJobApplicantAsync', () => {
  let userRepository: { resolvePublicIdToId: jest.Mock };
  let jobApplicantRepository: {
    getStatusContext: jest.Mock;
    transitionStatus: jest.Mock;
    acceptApplicantAndRejectOthers: jest.Mock;
  };
  let service: JobApplicantService;

  beforeEach(() => {
    userRepository = {
      resolvePublicIdToId: jest.fn().mockResolvedValue(ok(20)),
    };
    jobApplicantRepository = {
      getStatusContext: jest.fn().mockResolvedValue(
        ok({
          jobId: 10,
          jobOwnerId: 20,
          status: CommonJobApplicantStatus.PENDING,
          version: 3,
        }),
      ),
      transitionStatus: jest.fn().mockResolvedValue(ok(true)),
      acceptApplicantAndRejectOthers: jest.fn().mockResolvedValue(ok(true)),
    };
    service = new JobApplicantService(
      {} as IJobRepository,
      jobApplicantRepository as unknown as IJobApplicantRepository,
      userRepository as unknown as IUserRepository,
      {} as IResumeRepository,
    );
  });

  it('accepts the applicant and rejects the others when actor owns the job', async () => {
    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result.isOk()).toBe(true);
    expect(
      jobApplicantRepository.acceptApplicantAndRejectOthers,
    ).toHaveBeenCalledWith(
      'application-id',
      10,
      CommonJobApplicantStatus.PENDING,
      3,
    );
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('uses the regular transition for a rejected applicant', async () => {
    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.REJECTED,
    );

    expect(result.isOk()).toBe(true);
    expect(jobApplicantRepository.transitionStatus).toHaveBeenCalledWith(
      'application-id',
      10,
      CommonJobApplicantStatus.PENDING,
      CommonJobApplicantStatus.REJECTED,
    );
    expect(
      jobApplicantRepository.acceptApplicantAndRejectOthers,
    ).not.toHaveBeenCalled();
  });

  it('maps actor lookup failure to internal server error', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
  });

  it('returns not found when actor does not exist', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(null));

    const result = await service.confirmJobApplicantAsync(
      'missing-actor',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('maps application lookup failure to internal server error', async () => {
    jobApplicantRepository.getStatusContext.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
  });

  it('returns not found when application does not exist', async () => {
    jobApplicantRepository.getStatusContext.mockResolvedValue(ok(null));

    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'missing-application',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.NotFound);
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('forbids actor who does not own the job', async () => {
    userRepository.resolvePublicIdToId.mockResolvedValue(ok(99));

    const result = await service.confirmJobApplicantAsync(
      'other-actor',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.Forbidden);
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('rejects changing to the current status', async () => {
    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.PENDING,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.BadRequest);
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('rejects a forbidden status transition', async () => {
    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.COMPLETED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.BadRequest);
    expect(jobApplicantRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it('maps transition failure to internal server error', async () => {
    jobApplicantRepository.acceptApplicantAndRejectOthers.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.InternalServerError);
  });

  it('returns conflict when status changed concurrently', async () => {
    jobApplicantRepository.acceptApplicantAndRejectOthers.mockResolvedValue(
      ok(false),
    );

    const result = await service.confirmJobApplicantAsync(
      'actor-id',
      'application-id',
      CommonJobApplicantStatus.ACCEPTED,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.Conflict);
  });

  it.each(['actor', 'context', 'accept', 'transition'])(
    'preserves the %s failure and hides its details',
    async (stage) => {
      const failure = new Error('private dependency payload');
      const dependencies: Record<string, jest.Mock> = {
        actor: userRepository.resolvePublicIdToId,
        context: jobApplicantRepository.getStatusContext,
        accept: jobApplicantRepository.acceptApplicantAndRejectOthers,
        transition: jobApplicantRepository.transitionStatus,
      };
      dependencies[stage].mockResolvedValue(err(failure));
      const status =
        stage === 'transition'
          ? CommonJobApplicantStatus.REJECTED
          : CommonJobApplicantStatus.ACCEPTED;
      const error = (
        await service.confirmJobApplicantAsync('actor', 'application', status)
      )._unsafeUnwrapErr();
      expect(error.cause).toBe(failure);
      expect(error.message).not.toContain('private dependency payload');
    },
  );
});
