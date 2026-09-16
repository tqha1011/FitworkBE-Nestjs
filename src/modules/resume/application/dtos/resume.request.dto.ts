import { IsNumber, IsPositive, IsString } from 'class-validator';

export class CreateResumeRequestDto {}

export class UpdateResumeRequestDto {}

export class UploadResumeRequestDto {
  @IsString()
  fileName!: string;

  @IsString()
  contentType!: string;

  @IsNumber()
  @IsPositive()
  fileSize!: number;
}
