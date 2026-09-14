import { err, ok, Result } from 'neverthrow';
import { IJobApplicantService } from '../interfaces/job-applicant.service.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { JobApplicantRequestDto } from '../dtos/job.request.dto';
import { IJobRepository } from '../../domain/repositories/job.repo.interface';
import { IJobApplicantRepository } from '../../domain/repositories/job-applicant.repo.interface';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { IResumeRepository } from 'src/modules/resume/domain/repositories/resume.repo.interface';
import { JobApplicant } from '../../domain/entities/job-applicant.entity';

export class JobApplicantService implements IJobApplicantService {
  constructor(
    private readonly jobRepository: IJobRepository,
    private readonly jobApplicantRepository: IJobApplicantRepository,
    private readonly userRepository: IUserRepository,
    private readonly resumeRepository: IResumeRepository,
  ) {}
  async applyJobAsync(
    userPublicId: string,
    jobPublicId: string,
    request: JobApplicantRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const [userId, jobId, resumeId] = await Promise.all([
      this.userRepository.resolvePublicIdToId(userPublicId),
      this.jobRepository.getJobIdByPublicId(jobPublicId),
      this.resumeRepository.resolvePublicIdToId(request.resumePublicId),
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
    if (resumeId.isErr())
      return err(
        new AppError(ErrorCode.InternalServerError, resumeId.error.message),
      );
    if (!resumeId.value)
      return err(new AppError(ErrorCode.NotFound, 'Resume not found'));

    const jobApplicantResult = JobApplicant.create({
      jobId: jobId.value,
      applicantId: userId.value,
      resumeId: resumeId.value,
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
