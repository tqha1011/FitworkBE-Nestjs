import { Currency, JobStatus } from 'generated/prisma/enums';
import { CommonCurrency, CommonJobStatus } from 'src/shared/domain/enum';

const statusToPrisma: Record<CommonJobStatus, JobStatus> = {
  [CommonJobStatus.OPEN]: JobStatus.OPEN,
  [CommonJobStatus.CLOSED]: JobStatus.CLOSED,
};

const statusToDomain: Record<JobStatus, CommonJobStatus> = {
  [JobStatus.OPEN]: CommonJobStatus.OPEN,
  [JobStatus.CLOSED]: CommonJobStatus.CLOSED,
};

export function mapStatusToPrisma(status: CommonJobStatus): JobStatus {
  return statusToPrisma[status];
}

export function mapStatusToDomain(status: JobStatus): CommonJobStatus {
  return statusToDomain[status];
}

const currencyToPrisma: Record<CommonCurrency, Currency> = {
  [CommonCurrency.VND]: Currency.VND,
  [CommonCurrency.USD]: Currency.USD,
};

const currencyToDomain: Record<Currency, CommonCurrency> = {
  [Currency.VND]: CommonCurrency.VND,
  [Currency.USD]: CommonCurrency.USD,
};

export function mapCurrencyToPrisma(currency: CommonCurrency): Currency {
  return currencyToPrisma[currency];
}

export function mapCurrencyToDomain(currency: Currency): CommonCurrency {
  return currencyToDomain[currency];
}
