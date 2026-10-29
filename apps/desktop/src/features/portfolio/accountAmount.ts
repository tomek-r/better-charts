import { EMPTY_VALUE, formatMoney, withMinusSign } from '../../shared/format';
import type { MoneyAccount } from '../../shared/accountFormat';

const NONMONETARY_FRACTION_DIGITS = 2;

/** Account precision for money; two decimals for nonmonetary account metrics. */
export function accountAmount(value?: string, currency?: string, digits?: number): string {
  const text = value?.trim();
  if (!text) {
    return EMPTY_VALUE;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return text;
  }
  if (currency) {
    return formatMoney(parsed, currency, digits);
  }
  return withMinusSign(
    parsed.toLocaleString('en-US', {
      minimumFractionDigits: NONMONETARY_FRACTION_DIGITS,
      maximumFractionDigits: NONMONETARY_FRACTION_DIGITS,
    }),
  );
}

/** `accountAmount` in the currency and precision of the connected account. */
export function formatAccountAmount(value: string | undefined, account: MoneyAccount | undefined): string {
  return accountAmount(value, account?.currency, account?.currencyDigits);
}
