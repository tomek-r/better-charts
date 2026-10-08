import { currencyFractionDigits } from './money';
import type { QuoteSnapshot } from './bridge/types';

export function quoteDigits(...values: string[]) {
  return Math.min(
    8,
    Math.max(
      2,
      ...values.map((value) => {
        const fraction = value.split('.')[1];
        return fraction ? fraction.length : 2;
      }),
    ),
  );
}
export function formatQuote(value: string, digits: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

export interface QuotePresentation {
  precision: number;
  bidText: string;
  askText: string;
  spreadText: string;
  spreadPoints: number | null;
}

export function deriveQuotePresentation(
  quote: Pick<QuoteSnapshot, 'bid' | 'ask' | 'last'> | undefined,
  pointSize?: string,
): QuotePresentation {
  const precision = quote ? quoteDigits(quote.bid, quote.ask, quote.last) : 2;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const pointSizeNumber = Number(pointSize);

  return {
    precision,
    bidText: quote ? formatQuote(quote.bid, precision) : '—',
    askText: quote ? formatQuote(quote.ask, precision) : '—',
    spreadText: Number.isFinite(bid) && Number.isFinite(ask) ? (ask - bid).toFixed(precision) : '—',
    spreadPoints:
      Number.isFinite(bid) && Number.isFinite(ask) && Number.isFinite(pointSizeNumber) && pointSizeNumber > 0
        ? Math.round((ask - bid) / pointSizeNumber)
        : null,
  };
}

// Chart drag payloads carry numbers, but the wire grammar (order_decimal) forbids exponent notation and non-positive values. Normalize before drafting; undefined reads as "leave unchanged" so a level that cannot be expressed never reaches the backend as an invalid string.
export function draftLevel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value >= 1e21) {
    return undefined;
  }
  let text = String(value);
  if (text.includes('e')) {
    text = value.toFixed(12).replace(/\.?0+$/, '');
  }
  return Number(text) > 0 ? text : undefined;
}
// Ticket prices render and submit at the instrument's digits — chart payloads and ticks⇄price math carry float noise (e.g. 29571.64700000001) otherwise.
export function ticketPrice(value: number | string, digits: number | undefined): string {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? String(Number(price.toFixed(digits ?? 2))) : '';
}

export function normalizedPrice(value?: string | null) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = value.trim();
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}
/** MT5-style amounts: account precision and the deposit currency code. */
export function formatMoney(value: number, currency: string, digits?: number): string {
  const precision = currencyFractionDigits(digits);
  return `${value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })} ${currency}`;
}

export function formatSignedMoney(value: number, currency: string, digits?: number): string {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value), currency, digits)}`;
}
