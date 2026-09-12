import { randomUUID } from 'crypto';
import { CommonJobStatus } from 'src/shared/domain/enum';
import {
  JobDomainError,
  JobDomainErrorValidation,
} from '../errors/job-domain.error';
import { Result, ok, err } from 'neverthrow';

export type JobGetParams = {
  readonly id: number;
  readonly publicId: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  readonly location: string;
  readonly status: CommonJobStatus;
  readonly budget: number;
  readonly postedBy: number;
  readonly categoryId: number;
  readonly arrangementId: number;
  readonly dueAt: Date;
  readonly createdAt: Date;
  updatedAt: Date;
};

export type JobCreateParams = Omit<
  JobGetParams,
  'id' | 'publicId' | 'createdAt' | 'updatedAt'
>;
export class Job {
  private constructor(private readonly params: JobGetParams) {}

  static create(
    params: JobCreateParams,
  ): Result<Job, JobDomainErrorValidation> {
    // step validate information
    const validate = Job.validate(params);
    if (validate.isErr()) {
      return err(validate.error);
    }
    return ok(
      new Job({
        ...params,
        id: 0,
        publicId: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private static validate(
    params: JobCreateParams,
  ): Result<undefined, JobDomainErrorValidation> {
    if (params.dueAt && params.dueAt < new Date()) {
      return err(
        new JobDomainErrorValidation(
          JobDomainError.DueAtLessThanNow,
          'dueAt must be greater than or equal to now',
        ),
      );
    }

    if (params.budget && params.budget < 0) {
      return err(
        new JobDomainErrorValidation(
          JobDomainError.BudgetLessThanZero,
          'budget must be greater than or equal to zero',
        ),
      );
    }

    if (
      params.status &&
      !Object.values(CommonJobStatus).includes(params.status)
    ) {
      return err(
        new JobDomainErrorValidation(
          JobDomainError.InvalidJobStatus,
          'status must be one of the following: OPEN, CLOSED',
        ),
      );
    }
    return ok(undefined);
  }
  get id(): number {
    return this.params.id;
  }

  get status(): CommonJobStatus {
    return this.params.status;
  }

  get budget(): number {
    return this.params.budget;
  }

  get postedBy(): number {
    return this.params.postedBy;
  }

  get categoryId(): number {
    return this.params.categoryId;
  }

  get arrangementId(): number {
    return this.params.arrangementId;
  }

  get dueAt(): Date {
    return this.params.dueAt;
  }

  get createdAt(): Date {
    return this.params.createdAt;
  }

  get updatedAt(): Date {
    return this.params.updatedAt;
  }
  get publicId(): string {
    return this.params.publicId;
  }

  get title(): string {
    return this.params.title;
  }

  get requirements(): string {
    return this.params.requirements;
  }

  get location(): string {
    return this.params.location;
  }

  get description(): string {
    return this.params.description;
  }
}
