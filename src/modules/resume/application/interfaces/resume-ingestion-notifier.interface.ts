import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';

export const RESUME_INGESTION_UPDATED_EVENT = 'resume.ingestion.updated';

export type ResumeIngestionUpdatedEvent = {
  resumePublicId: string;
  ingestionPublicId: string;
  status: CommonResumeIngestionStatus;
  errorMessage?: string;
  updatedAt: string;
};

export abstract class IResumeIngestionNotifier {
  abstract notify(event: ResumeIngestionUpdatedEvent): Promise<void>;
}
