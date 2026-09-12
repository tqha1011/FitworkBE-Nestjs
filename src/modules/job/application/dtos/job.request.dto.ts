import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from 'src/shared/common/pagination';
import { IsGreaterThanOrEqual } from 'src/shared/common/validators/is-greater-than-or-equal.validator';
import { CommonCurrency, CommonJobStatus } from 'src/shared/domain/enum';

export class CreateJobRequestDto {
  @ApiPropertyOptional({ description: '' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: '' })
  @IsString()
  requirements: string;

  @ApiPropertyOptional({ description: '' })
  @IsNumber()
  budget: number;

  @ApiPropertyOptional({ description: '' })
  @IsEnum(CommonJobStatus)
  status: CommonJobStatus;

  @ApiPropertyOptional({ description: '' })
  @IsEnum(CommonCurrency)
  currency: CommonCurrency;

  @ApiPropertyOptional({ description: '' })
  @IsNumber()
  categoryId: number;

  @ApiPropertyOptional({ description: '' })
  @IsArray()
  @IsInt({ each: true, message: 'skillsId must be integers' })
  skillsId: number[];

  @ApiPropertyOptional({ description: '' })
  @Type(() => Date)
  @IsDate()
  dueAt: Date;

  @ApiPropertyOptional({ description: '' })
  @IsNumber()
  arrangementId: number;

  @ApiPropertyOptional({ description: '' })
  @IsString()
  location: string;
}

export class UpdateJobRequestDto {}

function toNumberArray({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? value.split(',').map((id) => Number(id.trim()))
    : value;
}

export class GetJobListRequestDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search jobs by title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Filter by category ids (comma-separated, e.g. "1,2")',
    type: [Number],
  })
  @IsOptional()
  @Transform(toNumberArray)
  @IsArray()
  @IsInt({ each: true, message: 'categoryIds must be integers' })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: 'Filter by skill ids (comma-separated, e.g. "1,2,3")',
    type: [Number],
  })
  @IsOptional()
  @Transform(toNumberArray)
  @IsArray()
  @IsInt({ each: true, message: 'skillIds must be integers' })
  skillIds?: number[];

  @ApiPropertyOptional({
    description: `Minimum budget, in base currency (${CommonCurrency.VND})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({
    description: `Maximum budget, in base currency (${CommonCurrency.VND})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('budgetMin', {
    message: 'budgetMax must be greater than or equal to budgetMin',
  })
  budgetMax?: number;
}
