import { palette } from '../../../../shared/theme/palette';

/** Label styling; values are CSS colours resolved at draw time. */
export interface BarCountdownOptions {
  textColor: string;
  backColor: string;
}

export const barCountdownDefaultOptions: BarCountdownOptions = {
  textColor: palette.text,
  backColor: palette.sell,
};

/**
 * Everything the countdown derives its tag from, all in chart units: broker
 * seconds and prices. The owning controller already tracks each field, so it
 * mirrors them in whenever one changes and never reads the object back. The
 * primitive copies what it needs, which lets the owner reuse one object.
 */
export interface BarCountdownState {
  /** Symbol whose bars the countdown belongs to. */
  symbol: string;
  /** MT5 timeframe code, including calendar-based MN1. */
  timeframe: string;
  /** Open time of the newest real bar, in broker seconds. */
  barTimeSeconds?: number;
  /** Price whose axis tag the countdown sits under (the Bid line). */
  anchorPrice?: number;
  /** The other side of the spread, so the countdown can clear the Bid tag. */
  askPrice?: number;
  connected: boolean;
  /** History or timeframe load in flight: hide rather than show stale time. */
  suspended: boolean;
}
