import { Result } from 'neverthrow';

export type ResumeEvaluationSnapshot = {
  text: string;
  hash: string;
  redactionVersion: 'resume-redaction-v1';
};

export abstract class IResumeRedactEvaluation {
  abstract redactResumeAsync(
    resumeContentPublicId: string,
  ): Promise<Result<ResumeEvaluationSnapshot | null, Error>>;
}
