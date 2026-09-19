import { Result } from 'neverthrow';

export abstract class IApplicantEvaluationProcessingService {
  abstract process(
    evaluationPublicId: string,
  ): Promise<Result<undefined, Error>>;
}
