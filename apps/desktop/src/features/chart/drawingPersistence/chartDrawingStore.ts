import { invoke } from '@tauri-apps/api/core';
import { readChartDrawingRecord, type ChartDrawingRecord } from '../engine/drawings/drawingRecord';

/**
 * Where the chart's drawings live: one list per account and symbol, kept by the Rust
 * backend in the app data folder. The interface is the whole contract, so a build with
 * another backend answers the same two calls.
 */
export interface ChartDrawingStore {
  /** Every drawing saved for one account and symbol; a list the backend could not read rejects. */
  load(accountKey: string, symbol: string): Promise<ChartDrawingRecord[]>;
  /** Replaces that list; an empty list removes what was saved. */
  save(accountKey: string, symbol: string, records: readonly ChartDrawingRecord[]): Promise<void>;
}

/** The backend's two commands, named after the trait they answer. */
const LOAD_DRAWINGS_COMMAND = 'load_chart_drawings';
const SAVE_DRAWINGS_COMMAND = 'save_chart_drawings';

/** Raised when the backend answered with something this build cannot read; the file stays untouched. */
const UNREADABLE_DRAWINGS_MESSAGE = 'Saved drawings could not be read';

/**
 * The loaded list, with every entry checked by the same validator the rest of the app
 * uses. The backend writes records in this shape, so an entry that fails here means the
 * file and this build disagree; loading it as an empty chart would then save over it.
 */
function readDrawingRecords(value: unknown): ChartDrawingRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(UNREADABLE_DRAWINGS_MESSAGE);
  }
  const records: ChartDrawingRecord[] = [];
  for (const entry of value) {
    const record = readChartDrawingRecord(entry);
    if (!record) {
      throw new Error(UNREADABLE_DRAWINGS_MESSAGE);
    }
    records.push(record);
  }
  return records;
}

/** The store of the desktop app: the two Rust commands, and nothing else. */
export function createTauriChartDrawingStore(): ChartDrawingStore {
  return {
    load: async (accountKey, symbol) => {
      const saved = await invoke(LOAD_DRAWINGS_COMMAND, { accountKey, symbol });
      return readDrawingRecords(saved);
    },
    save: async (accountKey, symbol, records) => {
      await invoke(SAVE_DRAWINGS_COMMAND, { accountKey, symbol, records });
    },
  };
}
