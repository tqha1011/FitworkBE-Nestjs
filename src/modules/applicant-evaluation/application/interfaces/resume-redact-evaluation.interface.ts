import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';

export type ResumeEvaluationSnapshot = {
  text: string;
  hash: string;
  redactionVersion: 'resume-redaction-v1';
};

export abstract class IResumeRedactEvaluation {
  abstract redactResumeAsync(
    extractedText: string,
  ): Promise<Result<ResumeEvaluationSnapshot, AppError>>;
}
