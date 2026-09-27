import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';
import { ApiProperty } from '@nestjs/swagger';

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
