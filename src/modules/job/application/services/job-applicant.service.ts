import { err, ok, Result } from 'neverthrow';
import { Injectable } from '@nestjs/common';
import { IJobApplicantService } from '../interfaces/job-applicant.service.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { JobApplicantRequestDto } from '../dtos/job.request.dto';
import { IJobRepository } from '../../domain/repositories/job.repo.interface';
import { IJobApplicantRepository } from '../../domain/repositories/job-applicant.repo.interface';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';
import { JobApplicant } from '../../domain/entities/job-applicant.entity';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { canTransitionJobApplicantStatus } from '../../domain/value-objects/job-applicant-status-transition';

@Injectable()
export class JobApplicantService implements IJobApplicantService {
  constructor(
    private readonly jobRepository: IJobRepository,
    private readonly jobApplicantRepository: IJobApplicantRepository,
    private readonly userRepository: IUserRepository,
    private readonly resumeRepository: IResumeRepository,
  ) {}
  async confirmJobApplicantAsync(
    actorPublicId: string,
    jobApplicantPublicId: string,
    nextStatus: CommonJobApplicantStatus,
  ): Promise<Result<undefined, AppError>> {
    const [actorIdResult, contextResult] = await Promise.all([
      this.userRepository.resolvePublicIdToId(actorPublicId),
      this.jobApplicantRepository.getStatusContext(jobApplicantPublicId),
    ]);

    if (actorIdResult.isErr())
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          actorIdResult.error.message,
        ),
      );
    if (!actorIdResult.value)
      return err(new AppError(ErrorCode.NotFound, 'User not found'));
    if (contextResult.isErr())
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          contextResult.error.message,
        ),
      );
    if (!contextResult.value)
      return err(
        new AppError(ErrorCode.NotFound, 'Job applicant was not found'),
      );
    if (contextResult.value.jobOwnerId !== actorIdResult.value)
      return err(
        new AppError(
          ErrorCode.Forbidden,
          'Only the job owner can change applicant status',
        ),
      );

    const currentStatus = contextResult.value.status;
    if (currentStatus === nextStatus)
      return err(
        new AppError(ErrorCode.BadRequest, 'No need to change status'),
      );
    if (!canTransitionJobApplicantStatus(currentStatus, nextStatus))
      return err(
        new AppError(
          ErrorCode.BadRequest,
          `Cannot change ${currentStatus} to ${nextStatus}`,
        ),
      );

    // automatically reject the others applicant if the applicant is accepted
    if (nextStatus === CommonJobApplicantStatus.ACCEPTED) {
      const result =
        await this.jobApplicantRepository.acceptApplicantAndRejectOthers(
          jobApplicantPublicId,
          contextResult.value.jobId,
          currentStatus,
        );
      if (result.isErr())
        return err(
          new AppError(ErrorCode.InternalServerError, result.error.message),
        );
      return ok(undefined);
    }
    const transitionResult = await this.jobApplicantRepository.transitionStatus(
      jobApplicantPublicId,
      contextResult.value.jobId,
      currentStatus,
      nextStatus,
    );
    if (transitionResult.isErr())
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          transitionResult.error.message,
        ),
      );
    if (!transitionResult.value)
      return err(
        new AppError(
          ErrorCode.Conflict,
          'Job applicant status changed; retry the request',
        ),
      );

    return ok(undefined);
  }
  async applyJobAsync(
    userPublicId: string,
    jobPublicId: string,
    request: JobApplicantRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const [userId, jobId, resume] = await Promise.all([
      this.userRepository.resolvePublicIdToId(userPublicId),
      this.jobRepository.getJobIdByPublicId(jobPublicId),
      this.resumeRepository.getResumeByPublicId(request.resumePublicId),
    ]);
    if (userId.isErr())
      return err(
        new AppError(ErrorCode.InternalServerError, userId.error.message),
      );
    if (!userId.value)
      return err(new AppError(ErrorCode.NotFound, 'User not found'));
    if (jobId.isErr())
      return err(
        new AppError(ErrorCode.InternalServerError, jobId.error.message),
      );
    if (!jobId.value)
      return err(new AppError(ErrorCode.NotFound, 'Job not found'));
    if (resume.isErr())
      return err(
        new AppError(ErrorCode.InternalServerError, resume.error.message),
      );
    if (!resume.value)
      return err(new AppError(ErrorCode.NotFound, 'Resume not found'));

    if (resume.value.userId !== userId.value)
      return err(
        new AppError(ErrorCode.Forbidden, 'Resume does not belong to user'),
      );

    const jobApplicantResult = JobApplicant.create({
      jobId: jobId.value,
      applicantId: userId.value,
      resumeId: resume.value.id,
      coverLetter: request.coverLetter,
      proposedRate: request.proposedRate,
      estimatedDay: request.estimatedDay,
    });
    if (jobApplicantResult.isErr())
      return err(
        new AppError(ErrorCode.BadRequest, jobApplicantResult.error.message),
      );

    const result = await this.jobApplicantRepository.addJobApplicant(
      jobApplicantResult.value,
    );
    if (result.isErr())
      return err(
        new AppError(ErrorCode.InternalServerError, result.error.message),
      );
    return ok(undefined);
  }
}
