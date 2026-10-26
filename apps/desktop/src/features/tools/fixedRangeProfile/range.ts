import { timeframeBarOffset, timeframeBarTime } from '../../../shared/bridge/timeframes';
import { anchorAtBar, reanchorToCurrentBars, type BarAnchor } from '../../chart/engine/tools/toolContract';
import type { TimeModel } from '../../chart/engine/viewport/viewportController';

/**
 * A committed fixed-range volume profile window, `[fromMs, endMs)`. The end is
 * time-anchored: it is the end of the slot the user chose, a real bar or an empty
 * future slot, and never moves. Whether the range is still collecting ticks is
 * derived from the newest bar (see `FixedRangeProfileTool.barsChanged`).
 */
export interface FixedRangeProfileRange {
  fromMs: number;
  endMs: number;
}

/**
 * A range as the user placed it: the window plus where its right-hand handle sits.
 * `lastSlotOpenMs` is the open time of the window's last slot (a real bar or an empty
 * future slot), while `endMs` is the exclusive end of that slot.
 */
export interface PlacedFixedRangeProfile extends FixedRangeProfileRange {
  lastSlotOpenMs: number;
}

export function sameRange(a: FixedRangeProfileRange, b: FixedRangeProfileRange): boolean {
  return a.fromMs === b.fromMs && a.endMs === b.endMs;
}

/**
 * Whether the range may still gain ticks: the newest bar opens before the range end. When the end falls INSIDE
 * that bar (a coarse timeframe after a switch), bar times cannot tell, so the feed decides: a quote at or past the
 * end means the range is final. A bar boundary at the end keeps the bar-based rule (its successor opens soon).
 */
export function isRangeOpen(barSeries: TimeModel, range: FixedRangeProfileRange, quoteTimeMs?: number): boolean {
  const bars = barSeries.bars;
  if (bars.length === 0) {
    return false;
  }
  const newestOpenMs = bars[bars.length - 1].time * 1000;
  if (newestOpenMs >= range.endMs) {
    return false;
  }
  const endInsideNewestBar = range.endMs < newestOpenMs + barSeries.intervalSeconds * 1000;
  const feedPassedEnd = quoteTimeMs !== undefined && quoteTimeMs >= range.endMs;
  return !(endInsideNewestBar && feedPassedEnd);
}

/** The window between two anchors; its start is a real bar, so a future start is clamped to the newest bar. */
export function spanBetweenAnchors(barSeries: TimeModel, a: BarAnchor, b: BarAnchor): PlacedFixedRangeProfile {
  // Stored anchors outlive bar changes; their time, not their slot, is the identity.
  const [early, late] = [reanchorToCurrentBars(barSeries, a), reanchorToCurrentBars(barSeries, b)].sort(
    (x, y) => x.timeMs - y.timeMs,
  );
  const start = anchorAtBar(barSeries, Math.min(early.index, barSeries.bars.length - 1));
  return rangeEndingAtAnchor(barSeries, start.timeMs, late);
}

/** The window from `fromMs` to the end of the slot `anchor` names. */
export function rangeEndingAtAnchor(barSeries: TimeModel, fromMs: number, anchor: BarAnchor): PlacedFixedRangeProfile {
  const { bars, timeframe, intervalSeconds } = barSeries;
  if (anchor.future) {
    // Same end-exclusive rule as a real bar, stepped by the timeframe from the newest bar.
    const newest = bars[bars.length - 1].time;
    const endSeconds = timeframeBarTime(timeframe, newest, anchor.index - (bars.length - 1) + 1);
    return { fromMs, endMs: endSeconds * 1000, lastSlotOpenMs: anchor.timeMs };
  }
  const end = anchor.index;
  // Preserve the original end-exclusive rule: the preceding real-bar delta
  // determines the selected last candle end, including session gaps.
  let interval = intervalSeconds;
  if (timeframe === 'MN1') {
    interval = timeframeBarTime('MN1', bars[end].time, 1) - bars[end].time;
  } else if (end > 0) {
    interval = bars[end].time - bars[end - 1].time;
  } else if (bars.length > 1) {
    interval = bars[bars.length - 1].time - bars[bars.length - 2].time;
  }
  return { fromMs, endMs: (bars[end].time + Math.max(0.001, interval)) * 1000, lastSlotOpenMs: anchor.timeMs };
}

/**
 * The open time of the slot that holds the instant `endMs - 1`, for a window that ends at `endMs`:
 * the last bar that opened at or before it, or, past the newest bar, the future slot the timeframe
 * steps to. A restored drawing derives its handle this way, because a slot is only known against
 * the bars of the moment. Undefined while no bar opened that early: the window predates the loaded
 * history.
 */
export function lastSlotOpenBefore(barSeries: TimeModel, endMs: number): number | undefined {
  const { bars, timeframe } = barSeries;
  if (bars.length === 0) {
    return undefined;
  }
  const lastInstantSeconds = (endMs - 1) / 1000;
  const newest = bars[bars.length - 1].time;
  if (newest > lastInstantSeconds) {
    const index = lastBarOpenedAtOrBefore(barSeries, lastInstantSeconds);
    return index === undefined ? undefined : bars[index].time * 1000;
  }
  const steps = Math.floor(timeframeBarOffset(timeframe, newest, lastInstantSeconds));
  return timeframeBarTime(timeframe, newest, steps) * 1000;
}

/** The index of the newest bar that opened at or before `timeSeconds`; undefined when every bar is later. */
function lastBarOpenedAtOrBefore(barSeries: TimeModel, timeSeconds: number): number | undefined {
  const { bars } = barSeries;
  if (bars[0].time > timeSeconds) {
    return undefined;
  }
  // The newest bar at or before the instant, found by bisection: history can be thousands of bars long.
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bars[middle].time <= timeSeconds) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}
