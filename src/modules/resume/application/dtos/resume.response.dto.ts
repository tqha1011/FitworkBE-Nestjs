import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';

export type ResumeResponseDto = {
  publicId: string;
  ingestionPublicId: string;
  ingestionStatus: CommonResumeIngestionStatus;
};

export type ResumeUploadResponseDto = {
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
};

export type ResumeDownloadUrlResponseDto = {
  downloadUrl: string;
};
