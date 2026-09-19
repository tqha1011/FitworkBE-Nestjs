import { CommonEvaluationStatus } from 'src/shared/domain/enum';

export const APPLICANT_EVALUATION_UPDATED_EVENT =
  'applicant.evaluation.updated';

export type ApplicantEvaluationUpdatedEvent = {
  evaluationPublicId: string;
  status: CommonEvaluationStatus;
  overallScore?: number;
  errorMessage?: string;
  updatedAt: string;
};

export abstract class IApplicantEvaluationNotifier {
  abstract notify(event: ApplicantEvaluationUpdatedEvent): Promise<void>;
}
