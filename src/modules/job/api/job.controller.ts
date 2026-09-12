import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { PageResult } from 'src/shared/common/pagination';
import {
  CreateJobRequestDto,
  GetJobListRequestDto,
} from '../application/dtos/job.request.dto';
import { JobItemResponseDto } from '../application/dtos/job.response.dto';
import { IJobService } from '../application/interfaces/job.service.interface';

@ApiTags('job')
@Controller('/api/job')
export class JobController {
  constructor(private readonly jobService: IJobService) {}

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
}
