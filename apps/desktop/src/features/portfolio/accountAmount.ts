import { formatMoney } from '../../shared/format';

/** Account precision for money; two decimals for nonmonetary account metrics. */
export function accountAmount(value?: string, currency?: string, digits?: number): string {
  const text = value?.trim();
  if (!text) {
    return '—';
  }
  const parsed = Number(text);
  if (currency && Number.isFinite(parsed)) {
    return formatMoney(parsed, currency, digits);
  }
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : text;
}
