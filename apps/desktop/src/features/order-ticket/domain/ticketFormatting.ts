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
