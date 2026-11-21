import type { IndicatorTick } from '../../../../shared/bridge/types';
import { buildTickBars, tickPrice } from '../../../indicators/calculation/tickBars';
import type { RenderBar } from './renderBar';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The chart library refuses equal times, so two N-tick bars whose ticks all
 * arrived within one second are drawn a second apart: the times are there to
 * order the bars, not to place them on the broker's clock.
 */
const MINIMUM_BAR_GAP_SECONDS = 1;

/** N-tick bars as a chart can draw them, and the ticks of the bar still forming. */
export interface TickBarTimeline {
  /** Every bar built so far, oldest first, with strictly increasing times. */
  readonly bars: readonly RenderBar[];
  /** Prices the newest bar groups so far, oldest first; empty once its last tick closed it. */
  readonly formingPrices: readonly number[];
}

/** The bar a tick opens: its own price is all of its open, high, low and close. */
function openedBar(timeSeconds: number, price: number): RenderBar {
  return { time: timeSeconds, open: price, high: price, low: price, close: price, volume: 1 };
}

/** The bar with one more tick folded into its high, low, close and count. */
function extendedBar(bar: RenderBar, price: number): RenderBar {
  return {
    ...bar,
    high: Math.max(bar.high, price),
    low: Math.min(bar.low, price),
    close: price,
    volume: bar.volume + 1,
  };
}

/** When a bar whose first tick arrived at `tickSeconds` is drawn: then, unless the bar before it has that second. */
function barTimeAfter(previous: RenderBar | undefined, tickSeconds: number): number {
  return previous === undefined ? tickSeconds : Math.max(tickSeconds, previous.time + MINIMUM_BAR_GAP_SECONDS);
}

/** The bars `ticks` build, in the order they arrived and timed so the chart accepts them. */
export function tickBarTimeline(ticks: readonly IndicatorTick[], ticksPerBar: number): TickBarTimeline {
  const series = buildTickBars(ticks, ticksPerBar);
  const bars: RenderBar[] = [];
  for (const bar of series.bars) {
    bars.push({ ...bar, time: barTimeAfter(bars[bars.length - 1], bar.time) });
  }
  return { bars, formingPrices: series.formingPrices };
}

/**
 * The timeline with one more tick folded in: into the newest bar while it is
 * still forming, or into a bar of its own once the newest one holds every tick
 * it groups. A tick carrying no price leaves the timeline as it was.
 */
export function foldTick(timeline: TickBarTimeline, tick: IndicatorTick, ticksPerBar: number): TickBarTimeline {
  const price = tickPrice(tick);
  if (price === null || ticksPerBar < 1) {
    return timeline;
  }
  if (timeline.formingPrices.length === 0) {
    const tickSeconds = Math.floor(tick.timeMs / MILLISECONDS_PER_SECOND);
    const time = barTimeAfter(timeline.bars[timeline.bars.length - 1], tickSeconds);
    return { bars: [...timeline.bars, openedBar(time, price)], formingPrices: [price] };
  }
  const bars = [...timeline.bars];
  const newest = bars.length - 1;
  bars[newest] = extendedBar(bars[newest], price);
  const formingPrices = [...timeline.formingPrices, price];
  return { bars, formingPrices: formingPrices.length >= ticksPerBar ? [] : formingPrices };
}
