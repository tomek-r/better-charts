import { palette } from '../../../../shared/theme/palette';

/** A broker tick timestamp for one symbol. */
export interface BrokerQuote {
  symbol: string;
  timeMs: number;
}

/** Label styling; values are CSS colours resolved at draw time. */
export interface BarCountdownOptions {
  textColor: string;
  backColor: string;
  /** Draw the small tick the library puts between the label and the axis edge. */
  tickVisible: boolean;
}

export const barCountdownDefaultOptions: BarCountdownOptions = {
  textColor: palette.text,
  backColor: palette.sell,
  tickVisible: false,
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
  /** Bar length in seconds (the chart timeframe). */
  intervalSeconds: number;
  /** Open time of the newest real bar, in broker seconds. */
  barTimeSeconds?: number;
  /** Price whose axis tag the countdown sits under (the Bid line). */
  anchorPrice?: number;
  /** The other side of the spread, so the countdown can clear the Bid tag. */
  askPrice?: number;
  connected: boolean;
  /** History or timeframe load in flight: hide rather than show stale time. */
  suspended: boolean;
  /** Changes when the bridge session changes, discarding the broker clock. */
  connectionIdentity: string;
  /** Newest tick; only a newer timestamp for the same symbol makes it live. */
  quote?: BrokerQuote;
}
