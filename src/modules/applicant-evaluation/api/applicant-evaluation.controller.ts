import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import { CreateApplicantEvaluationRequestDto } from '../application/dtos/applicant-evaluation.request.dto';
import {
  ApplicantEvaluationDetailDto,
  ApplicantEvaluationResponseDto,
} from '../application/dtos/applicant-evaluation.response.dto';
import { IApplicantEvaluationService } from '../application/interfaces/applicant-evaluation.service.interface';

@ApiTags('applicant-evaluation')
@Controller('/api/applicant-evaluation')
export class ApplicantEvaluationController {
  constructor(
    private readonly applicantEvaluationService: IApplicantEvaluationService,
  ) {}

  @Get(':evaluationPublicId')
  @Auth()
  @ApiOperation({ summary: 'Get an applicant evaluation result' })
  async getApplicantEvaluationDetail(
    @User() user: JwtPayload,
    @Param('evaluationPublicId') evaluationPublicId: string,
  ): Promise<ApplicantEvaluationDetailDto> {
    const result =
      await this.applicantEvaluationService.getApplicantEvaluationDetailAsync(
        user.sub,
        evaluationPublicId,
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
  @ApiOperation({ summary: 'Queue an applicant-to-job evaluation' })
  async evaluateApplicant(
    @User() user: JwtPayload,
    @Body() request: CreateApplicantEvaluationRequestDto,
  ): Promise<ApplicantEvaluationResponseDto> {
    const result = await this.applicantEvaluationService.evaluateApplicantAsync(
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
}
