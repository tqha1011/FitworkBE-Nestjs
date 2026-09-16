import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import {
  CreateJobRequestDto,
  GetJobListRequestDto,
  JobApplicantRequestDto,
  JobUpdateRequestDto,
} from '../application/dtos/job.request.dto';
import {
  JobApplicantResponseDto,
  JobItemResponseDto,
} from '../application/dtos/job.response.dto';
import { IJobService } from '../application/interfaces/job.service.interface';
import { IJobApplicantService } from '../application/interfaces/job-applicant.service.interface';
import { ICategoryService } from '../application/interfaces/category.service.interface';
import { IArrangementService } from '../application/interfaces/arrangement.service.interface';
import { PageResult } from 'src/shared/common/pagination';

@ApiTags('job')
@Controller('/api/job')
export class JobController {
  constructor(
    private readonly jobService: IJobService,
    private readonly jobApplicantService: IJobApplicantService,
    private readonly categoryService: ICategoryService,
    private readonly arrangementService: IArrangementService,
  ) {}

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Create a new job posting' })
  async createJob(
    @User() user: JwtPayload,
    @Body() dto: CreateJobRequestDto,
  ): Promise<void> {
    const result = await this.jobService.createJobAsync(user.sub, dto);
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'Search job postings' })
  async searchJobs(
    @Query() query: GetJobListRequestDto,
  ): Promise<PageResult<JobItemResponseDto>> {
    const result = await this.jobService.searchJobsAsync(query, {
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    });
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Patch(':jobPublicId')
  @Auth()
  @ApiOperation({ summary: 'Update a job posting' })
  async updateJob(
    @User() user: JwtPayload,
    @Param('jobPublicId') jobPublicId: string,
    @Body() request: JobUpdateRequestDto,
  ): Promise<void> {
    const result = await this.jobService.updateJobAsync(
      user.sub,
      jobPublicId,
      request,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
  }

  @Post(':jobPublicId/apply')
  @Auth()
  @ApiOperation({ summary: 'Apply for a job' })
  async applyForJob(
    @User() user: JwtPayload,
    @Body() request: JobApplicantRequestDto,
    @Param('jobPublicId') jobPublicId: string,
  ): Promise<JobApplicantResponseDto> {
    const result = await this.jobApplicantService.applyJobAsync(
      user.sub,
      jobPublicId,
      request,
    );
    return result.match(
      () => ({
        message: 'Applied successfully',
      }),
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
