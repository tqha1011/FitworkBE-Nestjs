import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from 'src/shared/common/pagination';

export class GetResumeListRequestDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export class CreateResumeRequestDto {
  @IsString()
  name!: string;

  @IsString()
  storageKey!: string;
}

export class UploadResumeRequestDto {
  @IsString()
  fileName!: string;

  @IsString()
  contentType!: string;

  @IsNumber()
  @IsPositive()
  fileSize!: number;
}

export class UpdateResumeRequestDto extends CreateResumeRequestDto {}
