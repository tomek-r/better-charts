import { invoke } from '@tauri-apps/api/core';

/**
 * Where each chart's time zone lives: one zone per account and symbol, kept by the Rust
 * backend in the app data folder. The interface is the whole contract, so a build with
 * another backend answers the same two calls.
 */
export interface ChartTimeZoneStore {
  /** The zone saved for one account and symbol, or null when that chart has none. */
  load(accountKey: string, symbol: string): Promise<string | null>;
  /** Replaces that chart's zone, so it opens in it next time. */
  save(accountKey: string, symbol: string, timeZone: string): Promise<void>;
}

/** The backend's two commands, named after the trait they answer. */
const LOAD_TIME_ZONE_COMMAND = 'load_chart_time_zone';
const SAVE_TIME_ZONE_COMMAND = 'save_chart_time_zone';

/** Raised when the backend answered with something this build cannot read; the file stays untouched. */
const UNREADABLE_TIME_ZONE_MESSAGE = "The chart's saved time zone could not be read";

/** The stored zone, or null for a chart that has none; anything else means the file is not a zone. */
function readTimeZone(value: unknown): string | null {
  if (value === null || typeof value === 'string') {
    return value;
  }
  throw new Error(UNREADABLE_TIME_ZONE_MESSAGE);
}

/** The store of the desktop app: the two Rust commands, and nothing else. */
export function createTauriChartTimeZoneStore(): ChartTimeZoneStore {
  return {
    load: async (accountKey, symbol) => {
      const saved = await invoke(LOAD_TIME_ZONE_COMMAND, { accountKey, symbol });
      return readTimeZone(saved);
    },
    save: async (accountKey, symbol, timeZone) => {
      await invoke(SAVE_TIME_ZONE_COMMAND, { accountKey, symbol, timeZone });
    },
  };
}
