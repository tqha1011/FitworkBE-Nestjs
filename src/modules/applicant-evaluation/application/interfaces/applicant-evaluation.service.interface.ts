import { Result } from 'neverthrow';
import { CreateApplicantEvaluationRequestDto } from '../dtos/applicant-evaluation.request.dto';
import { AppError } from 'src/shared/common/errorCode';

export abstract class IApplicantEvaluationService {
  // method call llm to evaluate the resume of applicant
  abstract evaluateApplicantAsync(
    applicantPublicId: string,
    data: CreateApplicantEvaluationRequestDto,
  ): Promise<Result<undefined, AppError>>;
}
