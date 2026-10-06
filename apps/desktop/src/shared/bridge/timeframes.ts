/**
 * The chart timeframes the bridge supports — read from the shared config
 * `config/timeframes.json`, which `crates/trading-core/src/protocol/timeframes.rs`
 * embeds at compile time. One file, both languages: edit the JSON, never a copy.
 *
 * `label` is presentation only, derived from the wire code (`M15` → `15m`,
 * `H1` → `1H`) so the tabs cannot disagree with the contract.
 */
import config from '../../../../../config/timeframes.json' with { type: 'json' };

/** Wire code shape: a unit and an amount (`M15`, `H1`, `MN1`). Declared before
 *  the options below, which label each code while this module initialises. */
const WIRE_CODE = /^(MN|[A-Z])(\d+)$/;

export const timeframeOptions = config.timeframes.map((entry) => ({
  wire: entry.code,
  label: timeframeLabel(entry.code),
  seconds: entry.seconds,
}));

/** Requested on connect, and the fallback while no timeframe is known yet. */
export const DEFAULT_TIMEFRAME: string = config.default;

/** `M15` → `15m`, `H1` → `1H`; an unexpected code is shown as it came. */
export function timeframeLabel(wire: string): string {
  const match = WIRE_CODE.exec(wire);
  if (!match) {
    return wire;
  }
  const [, unit, amount] = match;
  if (unit === 'M') {
    return `${amount}m`;
  }
  if (unit === 'MN') {
    return `${amount}M`;
  }
  return `${amount}${unit}`;
}

/** Nominal seconds per bar; MN1 boundaries use calendar months below. */
export function timeframeSeconds(wire: string): number {
  const entry = config.timeframes.find((candidate) => candidate.code === wire) ?? defaultEntry;
  return entry.seconds;
}

const defaultEntry = config.timeframes.find((entry) => entry.code === config.default) ?? config.timeframes[0];

/** Bar boundary after an offset. MT5 monthly bars follow calendar months. */
export function timeframeBarTime(wire: string, startSeconds: number, offset: number): number {
  if (wire !== 'MN1') {
    return startSeconds + offset * timeframeSeconds(wire);
  }
  const start = new Date(startSeconds * 1000);
  return (
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + offset,
      1,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
    ) / 1000
  );
}

/** Fractional bar offset, including times within a monthly candle. */
export function timeframeBarOffset(wire: string, startSeconds: number, timeSeconds: number): number {
  if (wire !== 'MN1') {
    return (timeSeconds - startSeconds) / timeframeSeconds(wire);
  }
  const start = new Date(startSeconds * 1000);
  const time = new Date(timeSeconds * 1000);
  let months = (time.getUTCFullYear() - start.getUTCFullYear()) * 12 + time.getUTCMonth() - start.getUTCMonth();
  if (timeSeconds < timeframeBarTime(wire, startSeconds, months)) {
    months--;
  }
  const from = timeframeBarTime(wire, startSeconds, months);
  const to = timeframeBarTime(wire, startSeconds, months + 1);
  return months + (timeSeconds - from) / (to - from);
}
