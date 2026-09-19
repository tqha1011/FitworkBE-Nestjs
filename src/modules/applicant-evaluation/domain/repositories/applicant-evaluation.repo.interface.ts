import { Result } from 'neverthrow';
import { JobSnapshotV1 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';

export type PrepareApplicantEvaluationInput = {
  applicantPublicId: string;
  jobId: number;
  resumeId: number;
  resumeContentId: number;
  jobSnapshot: JobSnapshotV1;
  jobContentHash: string;
  resumeContentHash: string;
  parserVersion: string;
  model: string;
  promptVersion: string;
};

export type PreparedApplicantEvaluation = {
  publicId: string;
  status: CommonEvaluationStatus;
  resetFromFailed: boolean;
};

export abstract class IApplicantEvaluationRepository {
  abstract prepare(
    input: PrepareApplicantEvaluationInput,
  ): Promise<Result<PreparedApplicantEvaluation | null, Error>>;
}
