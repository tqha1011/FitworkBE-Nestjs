export abstract class IApplicantEvaluationProcessingService {
  abstract evaluateApplicantWithLlmAsync(): Promise<void>;
}
