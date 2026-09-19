import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';

export class ResumeJoinDto {
  @IsUUID()
  resumePublicId: string;
}

export class ResumeLeaveDto extends ResumeJoinDto {}

export class ResumeIngestionNotificationDto {
  @IsUUID()
  resumePublicId: string;

  @IsUUID()
  ingestionPublicId: string;

  @IsEnum(CommonResumeIngestionStatus)
  status: CommonResumeIngestionStatus;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsDateString()
  updatedAt: string;
}

export class ResumeJoinResponseDto {
  joined: boolean;
  current?: ResumeIngestionNotificationDto;
}
