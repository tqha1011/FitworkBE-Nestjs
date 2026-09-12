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
} from '../dtos/job.request.dto';
import { JobItemResponseDto } from '../dtos/job.response.dto';
import { IUserRepository } from 'src/modules/users/domain/repositories/users.repo.interface';
import { PageResult, PaginationRequest } from 'src/shared/common/pagination';

@Injectable()
export class JobService implements IJobService {
  constructor(
    private readonly jobRepository: IJobRepository,
    private readonly jobQueryRepository: IJobQueryRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  async createJobAsync(
    postedByPublicId: string,
    request: CreateJobRequestDto,
  ): Promise<Result<undefined, AppError>> {
    const postedByIdResult =
      await this.userRepository.resolvePublicIdToId(postedByPublicId);
    if (postedByIdResult.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to resolve postedBy',
        ),
      );
    }
    const postedById = postedByIdResult.value;
    if (!postedById) {
      return err(
        new AppError(ErrorCode.NotFound, 'Can not find the job owner'),
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
      return err(new AppError(ErrorCode.BadRequest, job.error.message));
    }
    const addJobResult = await this.jobRepository.addJob(job.value);
    if (addJobResult.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to create job'),
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
        new AppError(ErrorCode.InternalServerError, 'Failed to search jobs'),
      );
    }
    return ok(result.value);
  }
}
