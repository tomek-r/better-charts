import { timeframeBarOffset, timeframeBarTime } from '../../../../shared/bridge/timeframes';
import type { TimeModel } from '../bars/timeModel';
import type { ChartToolHost } from './toolContract';

/**
 * A pointer anchored to a time slot. `index` counts bars from the oldest; a
 * `future` slot has `index >= bars.length`, and `timeMs` is its open time stepped
 * from the newest bar by the timeframe (calendar months for MN1).
 */
export interface BarAnchor {
  index: number;
  timeMs: number;
  future: boolean;
}

/** The anchor of a real bar. */
export function anchorAtBar(barSeries: TimeModel, index: number): BarAnchor {
  return { index, timeMs: barSeries.bars[index].time * 1000, future: false };
}

/**
 * The slot a tool anchors to under a pane x. Over a real bar it is that bar; in
 * the empty area right of the newest bar it is the future slot under the pointer,
 * not the newest bar, so a drawing can end at a time that has not happened yet.
 * Before the oldest bar there is no data to anchor to, so it stays null.
 */
export function anchorAtX(host: ChartToolHost, x: number): BarAnchor | null {
  const slot = host.geometry.slotAt(x);
  const { bars, timeframe } = host.barSeries;
  if (slot === null || slot < 0 || bars.length === 0) {
    return null;
  }
  if (slot < bars.length) {
    return anchorAtBar(host.barSeries, slot);
  }
  const newest = bars[bars.length - 1];
  const timeMs = timeframeBarTime(timeframe, newest.time, slot - (bars.length - 1)) * 1000;
  return Number.isFinite(timeMs) ? { index: slot, timeMs, future: true } : null;
}

/**
 * Re-resolves a stored anchor against the current bars. `index` is only valid for
 * the bars it was taken from; `timeMs` is the stable identity, so after a new bar
 * or prepended history the anchor is found again by time: a real bar by lookup,
 * a time past the newest bar as a future slot counted in timeframe steps.
 */
export function reanchorToCurrentBars(barSeries: TimeModel, anchor: BarAnchor): BarAnchor {
  const { bars, timeframe } = barSeries;
  if (bars.length === 0) {
    return anchor;
  }
  let low = 0;
  let high = bars.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (bars[mid].time * 1000 < anchor.timeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  if (bars[low].time * 1000 >= anchor.timeMs || low < bars.length - 1) {
    return anchorAtBar(barSeries, low);
  }
  const steps = Math.round(timeframeBarOffset(timeframe, bars[low].time, anchor.timeMs / 1000));
  return { index: low + steps, timeMs: anchor.timeMs, future: true };
}
