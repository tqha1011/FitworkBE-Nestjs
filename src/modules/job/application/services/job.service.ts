import { Injectable } from '@nestjs/common';
import { IJobService } from '../interfaces/job.service.interface';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { IJobRepository } from '../../domain/repositories/job.repo.interface';
import { IJobQueryRepository } from '../interfaces/job.query-repo.interface';
import { Job } from '../../domain/entities/job.entity';
import {
  CreateJobRequestDto,
  GetJobListRequestDto,
  JobUpdateRequestDto,
} from '../dtos/job.request.dto';
import {
  JobApplicantItemResponseDto,
  JobItemResponseDto,
} from '../dtos/job.response.dto';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';
import { ISkillRepository } from '../../domain/repositories/skill.repo.interface';
import { ICategoryRepository } from '../../domain/repositories/category.repo.interface';
import { IArrangementRepository } from '../../domain/repositories/arrangement.repo.interface';
import { IJobApplicantQueryRepo } from '../interfaces/job-applicant.query-repo.interface';

@Injectable()
export class JobService implements IJobService {
  constructor(
    private readonly jobRepository: IJobRepository,
    private readonly jobQueryRepository: IJobQueryRepository,
    private readonly jobApplicantQueryRepo: IJobApplicantQueryRepo,
    private readonly userRepository: IUserRepository,
    private readonly skillRepository: ISkillRepository,
    private readonly categoryRepository: ICategoryRepository,
    private readonly arrangementRepository: IArrangementRepository,
  ) {}

  async getJobsAppliedAsync(
    userPublicId: string,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<JobApplicantItemResponseDto>, AppError>> {
    const userIdResult =
      await this.userRepository.resolvePublicIdToId(userPublicId);
    if (userIdResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to resolve applicant',
          { cause: userIdResult.error },
        ),
      );
    }
    if (!userIdResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Applicant not found'));
    }

    const result = await this.jobApplicantQueryRepo.getJobsAppliedAsync(
      userIdResult.value,
      pagination.pageNumber,
      pagination.pageSize,
    );
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get jobs applied',
          { cause: result.error },
        ),
      );
    }

    return ok(result.value);
  }

  async createJobAsync(
    postedByPublicId: string,
    request: CreateJobRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const skillIds = [...new Set(request.skillsId)];
    const [
      postedByIdResult,
      categoryExistsResult,
      arrangementExistsResult,
      existingSkillIdsResult,
    ] = await Promise.all([
      this.userRepository.resolvePublicIdToId(postedByPublicId),
      this.categoryRepository.categoryExists(request.categoryId),
      this.arrangementRepository.arrangementExists(request.arrangementId),
      this.skillRepository.findExistingSkillIds(skillIds),
    ]);

    if (postedByIdResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to resolve postedBy',
          { cause: postedByIdResult.error },
        ),
      );
    }
    const postedById = postedByIdResult.value;
    if (!postedById) {
      return err(
        new AppError(ErrorCode.NotFound, 'Can not find the job owner'),
      );
    }

    if (categoryExistsResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to check category exists',
          { cause: categoryExistsResult.error },
        ),
      );
    }
    if (!categoryExistsResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Category not found'));
    }

    if (arrangementExistsResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to check arrangement exists',
          { cause: arrangementExistsResult.error },
        ),
      );
    }
    if (!arrangementExistsResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Arrangement not found'));
    }

    if (existingSkillIdsResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to validate skill ids',
          { cause: existingSkillIdsResult.error },
        ),
      );
    }
    const missingSkillIds = skillIds.filter(
      (id) => !existingSkillIdsResult.value.includes(id),
    );
    if (missingSkillIds.length > 0) {
      return err(
        new AppError(
          ErrorCode.NotFound,
          `Skill not found: ${missingSkillIds.join(', ')}`,
        ),
      );
    }

    const job = Job.create({
      title: request.title,
      description: request.description,
      requirements: request.requirements,
      location: request.location,
      status: request.status,
      budget: request.budget,
      currency: request.currency,
      dueAt: request.dueAt,
      postedBy: postedById,
      categoryId: request.categoryId,
      arrangementId: request.arrangementId,
    });
    if (job.isErr()) {
      return err(
        new AppError(ErrorCode.BadRequest, job.error.message, {
          cause: job.error,
        }),
      );
    }
    // add job + skills
    const addJobResult = await this.jobRepository.addJob(job.value, skillIds);
    if (addJobResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to create job', {
          cause: addJobResult.error,
        }),
      );
    }
    return ok(undefined);
  }

  async searchJobsAsync(
    request: GetJobListRequestDto,
    pagination: PaginationRequest,
  ): Promise<Result<PageResult<JobItemResponseDto>, AppError>> {
    const result = await this.jobQueryRepository.getListJobs(
      pagination.pageNumber,
      pagination.pageSize,
      {
        title: request.title,
        categoryIds: request.categoryIds,
        skillIds: request.skillIds,
        budgetMin: request.budgetMin,
        budgetMax: request.budgetMax,
      },
    );
    if (result.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to search jobs', {
          cause: result.error,
        }),
      );
    }
    return ok(result.value);
  }

  async updateJobAsync(
    userPublicId: string,
    jobPublicId: string,
    request: JobUpdateRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const [userIdResult, jobResult] = await Promise.all([
      this.userRepository.resolvePublicIdToId(userPublicId),
      this.jobRepository.getJobByPublicId(jobPublicId),
    ]);

    if (userIdResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to resolve job owner',
          { cause: userIdResult.error },
        ),
      );
    }
    if (!userIdResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Job owner not found'));
    }

    if (jobResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to get job', {
          cause: jobResult.error,
        }),
      );
    }
    if (!jobResult.value) {
      return err(new AppError(ErrorCode.NotFound, 'Job not found'));
    }
    if (jobResult.value.postedBy !== userIdResult.value) {
      return err(
        new AppError(
          ErrorCode.Forbidden,
          'You are not allowed to update this job',
        ),
      );
    }

    const updatedJobResult = jobResult.value.update(request);
    if (updatedJobResult.isErr()) {
      return err(
        new AppError(ErrorCode.BadRequest, updatedJobResult.error.message, {
          cause: updatedJobResult.error,
        }),
      );
    }

    const updateResult = await this.jobRepository.updateJob(
      updatedJobResult.value,
    );
    if (updateResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to update job', {
          cause: updateResult.error,
        }),
      );
    }
    return ok(undefined);
  }
}
