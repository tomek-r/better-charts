import type { RenderBar } from '../bars/renderBar';

const SECONDS_PER_DAY = 86_400;
const PERCENT = 100;
const PERCENT_DIGITS = 2;
const VOLUME_DIGITS = 2;
const VOLUME_UNIT = 1_000;
const PLUS_SIGN = '+';
const MINUS_SIGN = '\u2212';
const VOLUME_STEPS = [
  { size: 1_000_000_000, suffix: 'B' },
  { size: 1_000_000, suffix: 'M' },
  { size: VOLUME_UNIT, suffix: 'K' },
] as const;

function brokerDay(time: number): number {
  return Math.floor(time / SECONDS_PER_DAY);
}

function signedValue(value: number, text: string): string {
  return `${value < 0 ? MINUS_SIGN : PLUS_SIGN}${text}`;
}

export function formatPriceChange(close: number, reference: number, digits: number): string {
  const change = close - reference;
  const amount = signedValue(change, Math.abs(change).toFixed(digits));
  if (reference <= 0) {
    return amount;
  }
  const percent = Math.abs((change / reference) * PERCENT).toFixed(PERCENT_DIGITS);
  return `${amount} (${signedValue(change, percent)}%)`;
}

export function formatVolume(volume: number): string {
  const step = VOLUME_STEPS.find((candidate) => volume >= candidate.size);
  if (step === undefined) {
    return String(volume);
  }
  return `${(volume / step.size).toFixed(VOLUME_DIGITS)}${step.suffix}`;
}

export function barChangeReference(bar: RenderBar, previous: RenderBar | undefined): number {
  return previous === undefined ? bar.open : previous.close;
}

export function previousDayClose(bars: readonly RenderBar[], intervalSeconds: number): number | null {
  const lastBar = bars[bars.length - 1];
  // A bar longer than one day spans several days, so it has no previous day close.
  if (lastBar === undefined || intervalSeconds > SECONDS_PER_DAY) {
    return null;
  }
  const lastDay = brokerDay(lastBar.time);
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    const bar = bars[index];
    if (bar !== undefined && brokerDay(bar.time) < lastDay) {
      return bar.close;
    }
  }
  return null;
}
