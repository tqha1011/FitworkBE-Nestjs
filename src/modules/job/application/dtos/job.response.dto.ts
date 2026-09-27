import { ApiProperty } from '@nestjs/swagger';
import {
  CommonCurrency,
  CommonJobApplicantStatus,
  CommonJobStatus,
} from 'src/shared/domain/enum';

export class SkillResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class CategoryResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class ArrangementResponseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class JobItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  location!: string;

  @ApiProperty()
  budget!: number;

  @ApiProperty({ enum: CommonCurrency })
  currency!: CommonCurrency;

  @ApiProperty({ type: () => SkillResponseDto, isArray: true })
  skills!: SkillResponseDto[];

  @ApiProperty({ type: () => CategoryResponseDto })
  category!: CategoryResponseDto;

  @ApiProperty({ type: () => ArrangementResponseDto })
  arrangement!: ArrangementResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: Date;

  @ApiProperty()
  totalApplicants!: number;
}

export class JobApplicantResponseDto {
  @ApiProperty()
  message!: string;
}

export class JobApplicantItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  jobApplicantPublicId!: string;

  @ApiProperty({ format: 'uuid' })
  jobPublicId!: string;

  @ApiProperty({ enum: CommonJobApplicantStatus })
  status!: CommonJobApplicantStatus;

  @ApiProperty({ format: 'uuid' })
  resumePublicId!: string;

  @ApiProperty()
  proposedRate!: number;

  @ApiProperty()
  estimatedDays!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  appliedAt!: Date;

  @ApiProperty()
  matchingScore!: number;
}

export class JobPostedByResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  participatedSince!: Date;
}

export class JobDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  location!: string;

  @ApiProperty()
  requirements!: string;

  @ApiProperty()
  budget!: number;

  @ApiProperty({ enum: CommonCurrency })
  currency!: CommonCurrency;

  @ApiProperty({ enum: CommonJobStatus })
  status!: CommonJobStatus;

  @ApiProperty({ type: () => SkillResponseDto, isArray: true })
  skills!: SkillResponseDto[];

  @ApiProperty({ type: () => CategoryResponseDto })
  category!: CategoryResponseDto;

  @ApiProperty({ type: () => ArrangementResponseDto })
  arrangement!: ArrangementResponseDto;

  @ApiProperty({ type: () => JobPostedByResponseDto })
  postedBy!: JobPostedByResponseDto;

  @ApiProperty({ type: String, format: 'date-time' })
  dueAt!: Date;

  @ApiProperty()
  totalApplicants!: number;
}
