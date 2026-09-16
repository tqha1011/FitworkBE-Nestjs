import { IsNumber, IsPositive, IsString } from 'class-validator';

export class CreateResumeRequestDto {
  @IsString()
  name!: string;

  @IsString()
  storageKey!: string;
}

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
