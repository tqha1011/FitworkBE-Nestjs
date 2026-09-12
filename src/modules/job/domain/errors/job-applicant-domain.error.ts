export enum JobApplicantDomainError {
  ProposedRateLessThanZero = 'PROPOSED_RATE_LESS_THAN_ZERO',
  EstimatedDayLessThanOrEqualZero = 'ESTIMATED_DAY_LESS_THAN_OR_EQUAL_ZERO',
}

export class JobApplicantDomainErrorValidation extends Error {
  constructor(
    public readonly error: JobApplicantDomainError,
    message: string,
  ) {
    super(message);
  }
}
