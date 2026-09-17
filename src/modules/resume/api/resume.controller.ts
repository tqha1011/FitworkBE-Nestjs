import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import { CommonContentDisposition } from 'src/shared/domain/enum';
import {
  CreateResumeRequestDto,
  UpdateResumeRequestDto,
  UploadResumeRequestDto,
} from '../application/dtos/resume.request.dto';
import {
  ResumeDownloadUrlResponseDto,
  ResumeUploadResponseDto,
} from '../application/dtos/resume.response.dto';
import { IResumeService } from '../application/interfaces/resume.service.interface';

@ApiTags('resume')
@Controller('/api/resume')
export class ResumeController {
  constructor(private readonly resumeService: IResumeService) {}

  @Post('upload-url')
  @Auth()
  @ApiOperation({ summary: 'Generate a resume upload URL' })
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
  async createResume(
    @User() user: JwtPayload,
    @Body() request: CreateResumeRequestDto,
  ) {
    const result = await this.resumeService.createResumeAsync(
      user.sub,
      request,
    );
    return result.match(
      () => {
        return { message: 'Created successfully' };
      },
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Patch(':resumePublicId')
  @Auth()
  @ApiOperation({ summary: 'Update a resume from an uploaded file' })
  async updateResume(
    @User() user: JwtPayload,
    @Param('resumePublicId') resumePublicId: string,
    @Body() request: UpdateResumeRequestDto,
  ): Promise<void> {
    const result = await this.resumeService.updateResumeAsync(
      user.sub,
      resumePublicId,
      request,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
  }

  @Get(':resumePublicId/download-url')
  @Auth()
  @ApiOperation({ summary: 'Generate a resume download or preview URL' })
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
