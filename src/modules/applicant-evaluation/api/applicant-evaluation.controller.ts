import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import { CreateApplicantEvaluationRequestDto } from '../application/dtos/applicant-evaluation.request.dto';
import {
  ApplicantEvaluationDetailDto,
  ApplicantEvaluationForJobOwnerDto,
  ApplicantEvaluationResponseDto,
} from '../application/dtos/applicant-evaluation.response.dto';
import { IApplicantEvaluationService } from '../application/interfaces/applicant-evaluation.service.interface';
import { RolesGuard } from 'src/shared/common/roles.guard';
import { Roles } from 'src/shared/common/roles.decorator';
import { CommonUserRole } from 'src/shared/domain/enum';
import {
  APPLICANT_EVALUATION_DETAIL_RESPONSE_SCHEMA,
  APPLICANT_EVALUATION_OWNER_RESPONSE_SCHEMA,
} from './applicant-evaluation-response.schema';

@ApiTags('applicant-evaluation')
@Controller('/api/applicant-evaluation')
export class ApplicantEvaluationController {
  constructor(
    private readonly applicantEvaluationService: IApplicantEvaluationService,
  ) {}

  @Get(':evaluationPublicId')
  @Auth(RolesGuard)
  @Roles([CommonUserRole.ROLE_APPLICANT, CommonUserRole.ROLE_COMPANY])
  @ApiOperation({ summary: 'Get an applicant evaluation result' })
  @ApiResponse({
    status: 200,
    description: 'Completed evaluation for the applicant (V1 or V2)',
    schema: APPLICANT_EVALUATION_DETAIL_RESPONSE_SCHEMA,
  })
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

  @Get('jobs/:jobPublicId/:evaluationPublicId')
  @Auth(RolesGuard)
  @Roles([CommonUserRole.ROLE_COMPANY])
  @ApiOperation({ summary: 'Get an applicant evaluation for the job owner' })
  @ApiResponse({
    status: 200,
    description: 'Completed evaluation for the job owner (V1 or V2)',
    schema: APPLICANT_EVALUATION_OWNER_RESPONSE_SCHEMA,
  })
  async getApplicantEvaluationForJobOwner(
    @User() user: JwtPayload,
    @Param('jobPublicId') jobPublicId: string,
    @Param('evaluationPublicId') evaluationPublicId: string,
  ): Promise<ApplicantEvaluationForJobOwnerDto> {
    const result =
      await this.applicantEvaluationService.getApplicantEvaluationForJobOwnerAsync(
        user.sub,
        jobPublicId,
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
  @ApiResponse({
    status: 201,
    description: 'Evaluation queued or reused',
    schema: {
      type: 'object',
      required: ['publicId'],
      properties: { publicId: { type: 'string', format: 'uuid' } },
    },
  })
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
