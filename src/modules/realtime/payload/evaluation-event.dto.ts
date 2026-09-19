import { IsUUID } from 'class-validator';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';

export class EvaluationScoreEventDto {
  evaluationPublicId!: string;
  status!: CommonEvaluationStatus;
  overallScore?: number;
  errorMessage?: string;
  updatedAt!: string;
}

export class EvaluationJoinEventDto {
  @IsUUID()
  evaluationPublicId!: string;
}

export class EvaluationCurrentStateDto {
  evaluationPublicId!: string;
  status!: CommonEvaluationStatus;
  overallScore?: number;
  errorMessage?: string;
  updatedAt!: string;
}

export class EvaluationJoinResponseDto {
  joined!: boolean;
  current?: EvaluationCurrentStateDto;
}
