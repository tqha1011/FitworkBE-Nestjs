export enum JobDomainError {
  InvalidJobStatus = 'INVALID_JOB_STATUS',
  BudgetLessThanZero = 'BUDGET_LESS_THAN_ZERO',
  DueAtLessThanNow = 'DUE_AT_LESS_THAN_NOW',
  InvalidCurrency = 'INVALID_CURRENCY',
}

export class JobDomainErrorValidation extends Error {
  constructor(
    public readonly error: JobDomainError,
    message: string,
  ) {
    super(message);
  }
}
