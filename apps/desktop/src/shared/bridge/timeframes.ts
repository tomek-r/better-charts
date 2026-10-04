/**
 * The chart timeframes the bridge supports — read from the shared config
 * `config/timeframes.json`, which `crates/trading-core/src/protocol/timeframes.rs`
 * embeds at compile time. One file, both languages: edit the JSON, never a copy.
 *
 * `label` is presentation only, derived from the wire code (`M15` → `15m`,
 * `H1` → `1H`) so the tabs cannot disagree with the contract.
 */
import config from '../../../../../config/timeframes.json';

/** Wire code shape: a unit letter and an amount (`M15`, `H1`). Declared before
 *  the options below, which label each code while this module initialises. */
const WIRE_CODE = /^([A-Z])(\d+)$/;

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
  return unit === 'M' ? `${amount}m` : `${amount}${unit}`;
}

/** Bar length in seconds; an unknown code falls back to the default's length. */
export function timeframeSeconds(wire: string): number {
  const entry = config.timeframes.find((candidate) => candidate.code === wire) ?? defaultEntry;
  return entry.seconds;
}

const defaultEntry = config.timeframes.find((entry) => entry.code === config.default) ?? config.timeframes[0];
