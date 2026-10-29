import { timeframeBarOffset } from '../../../../shared/bridge/timeframes';
import type { RenderBar } from '../bars/renderBar';

/**
 * Fractional logical index of a time among the bars: a time between two bars lands
 * between their indices, one before the first bar on index 0, and one at or after the
 * newest bar counts timeframe steps past it. NaN when there are no bars or the time
 * is not finite.
 */
export function fractionalLogicalIndex(bars: readonly RenderBar[], timeframe: string, timeMs: number): number {
  if (!bars.length || !Number.isFinite(timeMs)) {
    return NaN;
  }
  const time = timeMs / 1000;
  const newest = bars[bars.length - 1];
  if (time >= newest.time) {
    // A minute selection can lie inside the current hourly candle. Retain
    // its sub-bar time rather than collapsing both boundaries to its open.
    return bars.length - 1 + timeframeBarOffset(timeframe, newest.time, time);
  }
  if (time <= bars[0].time) {
    return 0;
  }
  // The time lies strictly between the first and the newest bar.
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (bars[mid].time === time) {
      return mid;
    }
    if (bars[mid].time < time) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hi + (time - bars[hi].time) / (bars[lo].time - bars[hi].time);
}
