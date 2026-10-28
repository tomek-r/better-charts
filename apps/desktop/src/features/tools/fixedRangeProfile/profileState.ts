import type { ProfileResult } from '../../../shared/bridge/types';

/**
 * Volume profile (mirrored down/up bars by default), below trading labels; levels carry no labels. A `bars` profile is an approximation
 * (bid series = DOWN volume, ask = UP volume) and is the only one that carries text: its bar timeframe code.
 */
export interface FixedRangeProfileState {
  /** null/undefined = no active selection — the overlay renders nothing. */
  range?: { fromMs: number; toMs: number } | null;
  /** Profile computed for exactly `range` (Rust side, wire types). */
  profile?: ProfileResult;
  /** The awaited profile request is slow: the overlay veils the range and draws a spinner. Written only by the requester. */
  loadingIndicator?: boolean;
  /** A boundary preview hides the result until release or cancellation. */
  previewing?: boolean;
  /** Painted geometry from the last frame (dev hook / tests). */
  hit: {
    anchorX?: number;
    profileLeft?: number;
    profileRight?: number;
    pocY?: number;
    vahY?: number;
    valY?: number;
    /** The painted histogram box; absent while nothing is painted for it. */
    boxLeft?: number;
    boxRight?: number;
    boxTop?: number;
    boxBottom?: number;
    /** Row value labels painted; the totals line is reported by `summaryY` and absent when it is not painted. */
    valueLabels?: number;
    summaryY?: number;
    /** Where the labels and the totals line are anchored, and how their text is aligned there. */
    valueLabelX?: number;
    valueLabelAlign?: CanvasTextAlign;
  };
}

/** The profile request the app is waiting for; results that do not match it are stale and ignored. */
export type ExpectedFixedRangeProfile = {
  symbol: string;
  fromMs: number;
  endMs: number;
  sentAt: number;
  settled: boolean;
};
