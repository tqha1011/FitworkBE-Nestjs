import { Result } from 'neverthrow';

export abstract class IApplicantEvaluationProcessingService {
  abstract process(
    evaluationPublicId: string,
    attemptsMade: number, // total failed processing times in queue
    maxAttempts: number,
  ): Promise<Result<undefined, Error>>;
}
