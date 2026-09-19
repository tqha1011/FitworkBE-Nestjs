import { ApplicantEvaluationJobDto } from '../dtos/applicant-evaluation-job.dto';

export abstract class IApplicantEvaluationQueueInterface {
  abstract enqueue(request: ApplicantEvaluationJobDto): Promise<void>;
  abstract retry(request: ApplicantEvaluationJobDto): Promise<void>;
}
