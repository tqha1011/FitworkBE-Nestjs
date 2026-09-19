import { IsUUID } from 'class-validator';

export class ResumeJoinDto {
  @IsUUID()
  resumePublicId: string;
}
