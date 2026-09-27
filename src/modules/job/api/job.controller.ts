import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import {
  CreateJobRequestDto,
  GetJobListRequestDto,
  JobApplicantRequestDto,
  JobUpdateRequestDto,
  UpdateJobApplicantStatusRequestDto,
} from '../application/dtos/job.request.dto';
import {
  JobApplicantItemResponseDto,
  JobApplicantResponseDto,
  JobItemResponseDto,
} from '../application/dtos/job.response.dto';
import { IJobService } from '../application/interfaces/job.service.interface';
import { IJobApplicantService } from '../application/interfaces/job-applicant.service.interface';
import { ICategoryService } from '../application/interfaces/category.service.interface';
import { IArrangementService } from '../application/interfaces/arrangement.service.interface';
import { PageResult, PaginationQueryDto } from 'src/shared/common/pagination';
import { Roles } from 'src/shared/common/roles.decorator';
import { RolesGuard } from 'src/shared/common/roles.guard';
import { CommonUserRole } from 'src/shared/domain/enum';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from 'src/shared/common/swagger/api-standard-response.decorator';

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
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Job created' })
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
  @ApiPaginatedResponse(JobItemResponseDto)
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

  @Get('applied')
  @Auth()
  @ApiOperation({ summary: 'Get jobs applied by the current user' })
  @ApiPaginatedResponse(JobApplicantItemResponseDto)
  async getJobsApplied(
    @User() user: JwtPayload,
    @Query() query: PaginationQueryDto,
  ): Promise<PageResult<JobApplicantItemResponseDto>> {
    const result = await this.jobService.getJobsAppliedAsync(user.sub, query);
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
  @ApiResponse({ status: HttpStatus.OK, description: 'Job updated' })
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

  @Patch('applicants/:jobApplicantPublicId/status')
  @Auth(RolesGuard)
  @Roles([CommonUserRole.ROLE_COMPANY])
  @ApiOperation({ summary: 'Update a job applicant status' })
  @ApiStandardResponse(JobApplicantResponseDto)
  async updateJobApplicantStatus(
    @User() user: JwtPayload,
    @Param('jobApplicantPublicId') jobApplicantPublicId: string,
    @Body() request: UpdateJobApplicantStatusRequestDto,
  ): Promise<JobApplicantResponseDto> {
    const result = await this.jobApplicantService.confirmJobApplicantAsync(
      user.sub,
      jobApplicantPublicId,
      request.status,
    );
    return result.match(
      () => ({
        message: 'Job applicant status updated successfully',
      }),
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post(':jobPublicId/apply')
  @Auth()
  @ApiOperation({ summary: 'Apply for a job' })
  @ApiStandardResponse(JobApplicantResponseDto, { status: HttpStatus.CREATED })
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
