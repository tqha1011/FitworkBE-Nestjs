import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import { CommonContentDisposition } from 'src/shared/domain/enum';
import {
  ApiPaginatedResponse,
  ApiStandardResponse,
} from 'src/shared/common/swagger/api-standard-response.decorator';
import {
  ApiBadRequestErrorResponse,
  ApiInternalErrorResponse,
  ApiNotFoundErrorResponse,
} from 'src/shared/common/swagger/api-error-responses.decorator';
import { PageResult } from 'src/shared/common/pagination';
import {
  CreateResumeRequestDto,
  UpdateResumeRequestDto,
  UploadResumeRequestDto,
  GetResumeListRequestDto,
} from '../application/dtos/resume.request.dto';
import {
  ResumeDownloadUrlResponseDto,
  ResumeResponseDto,
  ResumeUploadResponseDto,
  ResumeReadResponseDto,
} from '../application/dtos/resume.response.dto';
import { IResumeService } from '../application/interfaces/resume.service.interface';

@ApiTags('resume')
@Controller('/api/resume')
export class ResumeController {
  constructor(private readonly resumeService: IResumeService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'Get resumes uploaded by the current user' })
  @ApiQuery({ type: GetResumeListRequestDto })
  @ApiPaginatedResponse(ResumeReadResponseDto)
  @ApiBadRequestErrorResponse()
  @ApiInternalErrorResponse()
  async getResumes(
    @User() user: JwtPayload,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: GetResumeListRequestDto,
  ): Promise<PageResult<ResumeReadResponseDto>> {
    const result = await this.resumeService.getResumesAsync(user.sub, query);
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Get(':resumePublicId')
  @Auth()
  @ApiOperation({
    summary: 'Get an owned resume and its current ingestion status',
  })
  @ApiStandardResponse(ResumeReadResponseDto)
  @ApiBadRequestErrorResponse()
  @ApiNotFoundErrorResponse()
  @ApiInternalErrorResponse()
  async getResumeDetail(
    @User() user: JwtPayload,
    @Param('resumePublicId', new ParseUUIDPipe()) resumePublicId: string,
  ): Promise<ResumeReadResponseDto> {
    const result = await this.resumeService.getResumeDetailAsync(
      user.sub,
      resumePublicId,
    );
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post('upload-url')
  @Auth()
  @ApiOperation({ summary: 'Generate a resume upload URL' })
  @ApiStandardResponse(ResumeUploadResponseDto, { status: HttpStatus.CREATED })
  async getUploadUrl(
    @User() user: JwtPayload,
    @Body() request: UploadResumeRequestDto,
  ): Promise<ResumeUploadResponseDto> {
    const result = await this.resumeService.getUploadUrlAsync(
      user.sub,
      request,
    );

    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: 'Create a resume from an uploaded file' })
  @ApiStandardResponse(ResumeResponseDto, { status: HttpStatus.CREATED })
  async createResume(
    @User() user: JwtPayload,
    @Body() request: CreateResumeRequestDto,
  ): Promise<ResumeResponseDto> {
    const result = await this.resumeService.createResumeAsync(
      user.sub,
      request,
    );
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Patch(':resumePublicId')
  @Auth()
  @ApiOperation({ summary: 'Update a resume from an uploaded file' })
  @ApiStandardResponse(ResumeResponseDto)
  async updateResume(
    @User() user: JwtPayload,
    @Param('resumePublicId') resumePublicId: string,
    @Body() request: UpdateResumeRequestDto,
  ): Promise<ResumeResponseDto> {
    const result = await this.resumeService.updateResumeAsync(
      user.sub,
      resumePublicId,
      request,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
    return result.value;
  }

  @Delete(':resumePublicId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth()
  @ApiOperation({ summary: 'Soft-delete a resume' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Resume deleted' })
  async deleteResume(
    @User() user: JwtPayload,
    @Param('resumePublicId') resumePublicId: string,
  ): Promise<void> {
    const result = await this.resumeService.deleteResumeAsync(
      user.sub,
      resumePublicId,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
  }

  @Get(':resumePublicId/download-url')
  @Auth()
  @ApiOperation({ summary: 'Generate a resume download or preview URL' })
  @ApiStandardResponse(ResumeDownloadUrlResponseDto)
  @ApiQuery({
    name: 'disposition',
    enum: CommonContentDisposition,
    required: false,
    description: 'Use inline to preview the resume in the browser',
  })
  async getDownloadUrl(
    @User() user: JwtPayload,
    @Param('resumePublicId') resumePublicId: string,
    @Query(
      'disposition',
      new DefaultValuePipe(CommonContentDisposition.ATTACHMENT),
      new ParseEnumPipe(CommonContentDisposition),
    )
    disposition: CommonContentDisposition,
  ): Promise<ResumeDownloadUrlResponseDto> {
    const result = await this.resumeService.getDownloadUrlAsync(
      user.sub,
      resumePublicId,
      disposition,
    );

    return result.match(
      (downloadUrl) => ({ downloadUrl }),
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
