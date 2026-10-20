/**
 * The one place E2E specs get dates from, so no spec hardcodes a calendar day.
 * Browser-safe (no Playwright import): the provider-isolation harness runs in the page.
 */

export const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 21:20 UTC. Fixes how the stub clock sits on every bar grid (M5, H1, H4...), whatever the date. */
const STUB_TIME_OF_DAY_MS = (21 * 60 + 20) * MS_PER_MINUTE;

const startOfUtcDayMs = (timeMs: number) => Math.floor(timeMs / MS_PER_DAY) * MS_PER_DAY;

/**
 * The broker clock the stub reports: 21:20 UTC yesterday, read once when the module loads, so every
 * value derived from it agrees. It is always in the past and never depends on the time of day the suite runs.
 */
export const STUB_NOW = startOfUtcDayMs(Date.now()) - MS_PER_DAY + STUB_TIME_OF_DAY_MS;

/** `15 Oct` for a UTC day, the way the app prints a broker date. */
export const formatDayMonth = (timeMs: number) => {
  const moment = new Date(timeMs);
  return `${moment.getUTCDate()} ${MONTH_NAMES[moment.getUTCMonth()]}`;
};
