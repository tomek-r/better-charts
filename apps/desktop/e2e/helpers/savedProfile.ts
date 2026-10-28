import type { DrawingTimeframeVisibility } from '../../src/features/chart/engine/drawings/timeframeVisibility';
import { STUB_M5_INTERVAL_MS, STUB_NOW } from './tauriStub';

/**
 * The saved drawing the drawing specs seed: a fixed range volume profile over bars 2..7 of the stub's
 * ten-bar window, in the shape the tool exports.
 */

/** The flags a seeded record carries: a locked drawing ignores gestures, a hidden one is never painted. */
export interface SavedProfileFlags {
  readonly locked: boolean;
  readonly visible: boolean;
  /** Painted under the price bars; a record without the flag sits above them. */
  readonly belowBars?: boolean;
  /** On which timeframes it paints; a record without the setting shows everywhere. */
  readonly timeframeVisibility?: DrawingTimeframeVisibility;
}

/** One profile record, as the stub's backend holds it. */
export function savedProfile(id: string, { locked, visible, belowBars, timeframeVisibility }: SavedProfileFlags) {
  return {
    id,
    toolId: 'fixedRangeProfile',
    locked,
    visible,
    belowBars,
    timeframeVisibility,
    inputs: {},
    points: [
      { timeMs: STUB_NOW - 8 * STUB_M5_INTERVAL_MS, price: null },
      { timeMs: STUB_NOW - 3 * STUB_M5_INTERVAL_MS, price: null },
    ],
  };
}
