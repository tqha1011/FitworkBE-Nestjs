import { IsUUID } from 'class-validator';

export class CreateApplicantEvaluationRequestDto {
  @IsUUID()
  resumePublicId!: string;

  @IsUUID()
  jobPublicId!: string;
}

export class UpdateApplicantEvaluationRequestDto {}
