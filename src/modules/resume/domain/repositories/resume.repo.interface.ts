import { Result } from 'neverthrow';
import { Resume } from '../entities/resume.entity';

export type ResumeStorageData = {
  resumeId: number;
  ownerPublicId: string;
  storageKey: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export abstract class IResumeRepository {
  abstract addResume(resume: Resume): Promise<Result<undefined, Error>>;

  abstract updateResume(resume: Resume): Promise<Result<undefined, Error>>;

  abstract resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;

  abstract getResumeStorageData(
    publicId: string,
  ): Promise<Result<ResumeStorageData | null, Error>>;

  abstract getResumeByPublicId(
    publicId: string,
  ): Promise<Result<Resume | null, Error>>;

  abstract deleteResume(publicId: string): Promise<Result<undefined, Error>>;
}
