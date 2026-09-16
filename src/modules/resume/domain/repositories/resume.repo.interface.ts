import { Result } from 'neverthrow';

export type ResumeStorageData = {
  resumeId: number;
  storageKey: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

export abstract class IResumeRepository {
  abstract resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;

  abstract getResumeStorageData(
    publicId: string,
  ): Promise<Result<ResumeStorageData | null, Error>>;
}
