import { HISTORY_BARS, INITIAL_HISTORY_BARS } from '../../../../shared/bridge/config';
import { isPositiveFinite } from '../../../../shared/finiteNumber';
import { DEFAULT_BAR_SPACING, END_MARGIN } from '../timeScale/futureTimePoints';

/** Bars beyond the visible span, so a small pan does not immediately reveal a gap. */
const SLACK_BARS = 50;
/** Never request fewer than this, however narrow the pane: tiny snapshots add churn, not speed. */
const MIN_WINDOW_BARS = 100;

/**
 * How many bars the first request should ask for so the pane is covered without
 * loading a whole page: the bars that fit at the (default or tighter) spacing,
 * the right-hand end margin and some slack. An unmeasured pane (0, NaN) falls
 * back to the configured `INITIAL_HISTORY_BARS`; the result is always within
 * `1..=HISTORY_BARS`, because the adapter and backend treat 0 as invalid.
 */
export function initialHistoryWindow(paneWidth: number, barSpacing: number = DEFAULT_BAR_SPACING): number {
  if (!isPositiveFinite(paneWidth) || !isPositiveFinite(barSpacing)) {
    return INITIAL_HISTORY_BARS;
  }
  // A reset view uses the default spacing, so a wider zoom never needs more bars than that.
  const fit = Math.ceil(paneWidth / Math.min(DEFAULT_BAR_SPACING, barSpacing)) + END_MARGIN + SLACK_BARS;
  return Math.min(HISTORY_BARS, Math.max(MIN_WINDOW_BARS, fit));
}

/** What the first history request asks the chart: how many bars its pane, as measured now, needs. */
export interface InitialHistoryProvider {
  initialHistoryBars(): number;
}

/** The window for the chart as it is now, or the configured default before it exists. */
export function initialHistoryBarsFor(chart: InitialHistoryProvider | null): number {
  return chart?.initialHistoryBars() ?? INITIAL_HISTORY_BARS;
}
