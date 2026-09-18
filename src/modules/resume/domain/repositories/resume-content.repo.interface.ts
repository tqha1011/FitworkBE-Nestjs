import { Result } from 'neverthrow';
import { ResumeContentRecord } from '../entities/resume-content.entity';

export type CompleteResumeContentInput = {
  publicId: string;
  extractedText: string;
  contentHash: string;
};

export abstract class IResumeContentRepository {
  abstract getByPublicId(
    publicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>>;

  abstract getCurrentForOwner(
    resumePublicId: string,
    ownerPublicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>>;

  abstract markProcessing(
    publicId: string,
  ): Promise<Result<ResumeContentRecord | null, Error>>;

  abstract markCompleted(
    input: CompleteResumeContentInput,
  ): Promise<Result<ResumeContentRecord | null, Error>>;

  abstract markFailed(
    publicId: string,
    errorMessage: string,
  ): Promise<Result<ResumeContentRecord | null, Error>>;
}
