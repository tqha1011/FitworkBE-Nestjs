import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from 'src/shared/common/pagination';
import { IsGreaterThanOrEqual } from 'src/shared/common/validators/is-greater-than-or-equal.validator';

export class CreateJobRequestDto {}

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

  @ApiPropertyOptional({ description: 'Minimum budget' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ description: 'Maximum budget' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsGreaterThanOrEqual('budgetMin', {
    message: 'budgetMax must be greater than or equal to budgetMin',
  })
  budgetMax?: number;
}
