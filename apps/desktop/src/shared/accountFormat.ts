import type { AccountSnapshot } from './bridge/types';
import { formatMoney } from './format';

export type MoneyAccount = Pick<AccountSnapshot, 'currency' | 'currencyDigits'>;
export type MarginLevelAccount = MoneyAccount & Pick<AccountSnapshot, 'marginLevelsUnit'>;

/** Decimal-string wire value to a finite number; blank, null and non-numeric are undefined. */
export function finiteNumber(value: string | null | undefined): number | undefined {
  return value !== null && value !== undefined && value.trim() !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : undefined;
}

/** Amount in the account currency, or undefined when the value or currency is missing. */
export function formatAccountMoney(value: string | null | undefined, account: MoneyAccount | undefined) {
  const amount = finiteNumber(value);
  return account?.currency && amount !== undefined
    ? formatMoney(amount, account.currency, account.currencyDigits)
    : undefined;
}

// ENUM_ACCOUNT_MARGIN_MODE: 0 retail netting, 1 exchange, 2 retail hedging.
const MARGIN_MODE_NAMES: Record<number, string> = { 0: 'Netting', 1: 'Exchange', 2: 'Hedging' };

/** Position accounting model of the account; undefined for an unknown mode. */
export function marginModeName(mode: number): string | undefined {
  return MARGIN_MODE_NAMES[mode];
}

/**
 * Margin call / stop out threshold. The unit follows ACCOUNT_MARGIN_SO_MODE:
 * percentages or account-currency amounts. Undefined when unknown.
 */
export function formatMarginThreshold(
  value: string | null | undefined,
  account: MarginLevelAccount | undefined,
): string | undefined {
  const amount = finiteNumber(value);
  if (amount === undefined) {
    return undefined;
  }
  if (account?.marginLevelsUnit === 'percent') {
    return `${amount}%`;
  }
  return account?.marginLevelsUnit === 'money' ? formatAccountMoney(value, account) : undefined;
}
