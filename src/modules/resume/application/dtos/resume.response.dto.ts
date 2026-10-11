import {
  CommonFileType,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';
import { ApiProperty } from '@nestjs/swagger';

export class ResumeReadResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty({ enum: CommonFileType })
  fileType!: CommonFileType;

  @ApiProperty({ description: 'File size in bytes', type: 'integer' })
  fileSize!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  ingestionPublicId!: string | null;

  @ApiProperty({
    type: String,
    enum: CommonResumeIngestionStatus,
    nullable: true,
  })
  ingestionStatus!: CommonResumeIngestionStatus | null;
}

export class ResumeResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicId!: string;

  @ApiProperty({ format: 'uuid' })
  ingestionPublicId!: string;

  @ApiProperty({ enum: CommonResumeIngestionStatus })
  ingestionStatus!: CommonResumeIngestionStatus;
}

export class ResumeUploadResponseDto {
  @ApiProperty({ format: 'uri' })
  uploadUrl!: string;

  @ApiProperty()
  storageKey!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}

export class ResumeDownloadUrlResponseDto {
  @ApiProperty({ format: 'uri' })
  downloadUrl!: string;
}
