import { randomUUID } from 'crypto';
import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import {
  JobApplicantDomainError,
  JobApplicantDomainErrorValidation,
} from '../errors/job-applicant-domain.error';
import { Result, ok, err } from 'neverthrow';

export type JobApplicantGetParams = {
  readonly id: number;
  readonly publicId: string;
  readonly jobId: number;
  readonly applicantId: number;
  readonly resumeId: number;
  readonly coverLetter: string;
  readonly proposedRate: number;
  readonly estimatedDay: number;
  readonly status: CommonJobApplicantStatus;
  readonly appliedAt: Date;
  updatedAt: Date;
};

export type JobApplicantCreateParams = Omit<
  JobApplicantGetParams,
  'id' | 'publicId' | 'status' | 'appliedAt' | 'updatedAt'
>;

export class JobApplicant {
  private constructor(private readonly params: JobApplicantGetParams) {}

  static create(
    params: JobApplicantCreateParams,
  ): Result<JobApplicant, JobApplicantDomainErrorValidation> {
    // step validate information
    const validate = JobApplicant.validate(params);
    if (validate.isErr()) {
      return err(validate.error);
    }
    return ok(
      new JobApplicant({
        ...params,
        id: 0,
        publicId: randomUUID(),
        status: CommonJobApplicantStatus.PENDING,
        appliedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private static validate(
    params: JobApplicantCreateParams,
  ): Result<undefined, JobApplicantDomainErrorValidation> {
    if (params.proposedRate < 0) {
      return err(
        new JobApplicantDomainErrorValidation(
          JobApplicantDomainError.ProposedRateLessThanZero,
          'proposedRate must be greater than or equal to zero',
        ),
      );
    }

    if (params.estimatedDay <= 0) {
      return err(
        new JobApplicantDomainErrorValidation(
          JobApplicantDomainError.EstimatedDayLessThanOrEqualZero,
          'estimatedDay must be greater than zero',
        ),
      );
    }

    return ok(undefined);
  }

  get id(): number {
    return this.params.id;
  }

  get publicId(): string {
    return this.params.publicId;
  }

  get jobId(): number {
    return this.params.jobId;
  }

  get applicantId(): number {
    return this.params.applicantId;
  }

  get resumeId(): number {
    return this.params.resumeId;
  }

  get coverLetter(): string {
    return this.params.coverLetter;
  }

  get proposedRate(): number {
    return this.params.proposedRate;
  }

  get estimatedDay(): number {
    return this.params.estimatedDay;
  }

  get status(): CommonJobApplicantStatus {
    return this.params.status;
  }

  get appliedAt(): Date {
    return this.params.appliedAt;
  }

  get updatedAt(): Date {
    return this.params.updatedAt;
  }
}
