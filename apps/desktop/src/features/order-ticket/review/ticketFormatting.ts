/** Shown on the review button and the start button while the MT5 OrderCheck is in flight. */
export const CHECKING_LABEL = 'Checking with MT5…';

export function formatQuoted(value?: number) {
  if (value === undefined) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
export function formatOrderMetric(value?: string | null, suffix = '') {
  return value === undefined || value === null || value === '' ? '—' : `${value}${suffix}`;
}
