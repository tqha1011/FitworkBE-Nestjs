import {
  CommonFileType,
  CommonResumeIngestionStatus,
} from 'src/shared/domain/enum';

export type ResumeContentSnapshot = {
  storagePath: string;
  fileSize: number;
  fileType: CommonFileType;
  fileName: string;
  parserVersion: string;
};

export type ResumeContentRecord = ResumeContentSnapshot & {
  id: number;
  publicId: string;
  resumeId: number;
  resumePublicId: string;
  ownerPublicId: string;
  status: CommonResumeIngestionStatus;
  errorMessage: string | null;
  extractedText: string | null;
  contentHash: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ResumeIngestionReference = {
  publicId: string;
  ingestionPublicId: string;
  ingestionStatus: CommonResumeIngestionStatus;
};
