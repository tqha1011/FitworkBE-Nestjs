import { CommonCurrency } from 'src/shared/domain/enum';

/**
 * Frozen exchange rates, not live-fetched. Good enough for filtering/sorting
 * budgets across currencies in this project; revisit if real accuracy matters.
 */
export const BASE_CURRENCY = CommonCurrency.VND;

export const EXCHANGE_RATE_TO_BASE: Record<CommonCurrency, number> = {
  [CommonCurrency.VND]: 1,
  [CommonCurrency.USD]: 25_000,
};

export function convertToBaseCurrency(
  amount: number,
  currency: CommonCurrency,
): number {
  return amount * EXCHANGE_RATE_TO_BASE[currency];
}
