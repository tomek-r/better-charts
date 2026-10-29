import { currencyFractionDigits } from './money';
import type { BrokerSymbol, QuoteSnapshot } from './bridge/types';

/** What a value shows when it is missing or not a number. */
export const EMPTY_VALUE = '—';

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

/** Symbol-info may not have arrived yet, so the quote text then carries the price precision. */
export function priceDigitsFor(
  instrument: Pick<BrokerSymbol, 'digits'> | undefined,
  quote: Pick<QuoteSnapshot, 'bid' | 'ask'> | undefined,
  fallback = 2,
) {
  return instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : fallback);
}

export function formatQuote(value: string, digits: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

const DECIMAL_VOLUME = /^(\d+)(?:\.(\d*))?$/;

/**
 * The one display rule for volumes: the EA's 8-decimal padding (`"0.05000000"`) is noise, so insignificant
 * trailing zeros and a dangling point are dropped. Pure string work, so no digit is ever lost to float rounding.
 * Text that is not a plain non-negative decimal is returned unchanged.
 */
export function formatVolume(value: string): string {
  const match = DECIMAL_VOLUME.exec(value);
  if (!match) {
    return value;
  }
  const [, whole, fraction = ''] = match;
  const significant = fraction.replace(/0+$/, '');
  return significant ? `${whole}.${significant}` : whole;
}

/** Volume with the app's unit word ("units"), the one wording used by partial close and the portfolio row. */
export function volumeWithUnit(volume: string): string {
  return `${formatVolume(volume)} units`;
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

/** Typographic minus (U+2212): every negative number the user reads uses it, never the ASCII hyphen. */
export const MINUS_SIGN = '−';

/**
 * Display only: swaps the leading ASCII '-' of a rendered number for the typographic minus. Text that is parsed,
 * typed into an input or sent to the bridge keeps the ASCII hyphen, so this never touches anything but the sign.
 */
export function withMinusSign(text: string): string {
  return text.startsWith('-') ? `${MINUS_SIGN}${text.slice(1)}` : text;
}

/** MT5-style amounts: account precision and the deposit currency code. */
export function formatMoney(value: number, currency: string, digits?: number): string {
  const precision = currencyFractionDigits(digits);
  const amount = value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return withMinusSign(`${amount} ${currency}`);
}

export function formatSignedMoney(value: number, currency: string, digits?: number): string {
  return `${value >= 0 ? '+' : MINUS_SIGN}${formatMoney(Math.abs(value), currency, digits)}`;
}
