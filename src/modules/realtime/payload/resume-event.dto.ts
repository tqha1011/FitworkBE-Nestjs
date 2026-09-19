import { IsUUID } from 'class-validator';

export class ResumeJoinDto {
  @IsUUID()
  resumePublicId: string;
}

export class ResumeLeaveDto extends ResumeJoinDto {}
