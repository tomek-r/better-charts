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

/** The bars a chart's tick read draws, and the ticks an older page completes before they become a bar. */
export interface TickBarHold {
  /** The bars to draw, oldest first: each holds exactly the ticks its interval groups. */
  readonly bars: readonly RenderBar[];
  /** The ticks of the oldest bar the read left short, which the next older page completes. */
  readonly oldestTicks: readonly IndicatorTick[];
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

/** When a bar whose own second is `timeSeconds` is drawn: then, unless the bar before it already has that second. */
export function barTimeAfter(previousTime: number | undefined, timeSeconds: number): number {
  return previousTime === undefined ? timeSeconds : Math.max(timeSeconds, previousTime + MINIMUM_BAR_GAP_SECONDS);
}

/** The ticks a bar can be built from, in the order they arrived: one carrying no price is no tick at all. */
function pricedTicks(ticks: readonly IndicatorTick[]): readonly IndicatorTick[] {
  return ticks.filter((tick) => tickPrice(tick) !== null);
}

/** The bars `ticks` build, in the order they arrived and timed so the chart accepts them. */
export function tickBarTimeline(ticks: readonly IndicatorTick[], ticksPerBar: number): TickBarTimeline {
  const series = buildTickBars(ticks, ticksPerBar);
  const bars: RenderBar[] = [];
  for (const bar of series.bars) {
    bars.push({ ...bar, time: barTimeAfter(bars[bars.length - 1]?.time, bar.time) });
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
    const time = barTimeAfter(timeline.bars[timeline.bars.length - 1]?.time, tickSeconds);
    return { bars: [...timeline.bars, openedBar(time, price)], formingPrices: [price] };
  }
  const bars = [...timeline.bars];
  const newest = bars.length - 1;
  bars[newest] = extendedBar(bars[newest], price);
  const formingPrices = [...timeline.formingPrices, price];
  return { bars, formingPrices: formingPrices.length >= ticksPerBar ? [] : formingPrices };
}

/**
 * The bars a read's ticks build for the chart, grouped from the newest tick back so every bar it draws holds the
 * ticks its interval groups: a read starts mid-stream, so the ticks short of a bar are its oldest ones, which an
 * older page completes.
 */
export function heldTickBars(ticks: readonly IndicatorTick[], ticksPerBar: number): TickBarHold {
  const priced = pricedTicks(ticks);
  if (ticksPerBar < 1) {
    return { bars: [], oldestTicks: [] };
  }
  const shortOfBar = priced.length % ticksPerBar;
  const { bars } = tickBarTimeline(priced.slice(shortOfBar), ticksPerBar);
  return { bars, oldestTicks: priced.slice(0, shortOfBar) };
}

/** `bars` timed so the newest of them sits just before `nextTime`, the bar the chart already draws after them. */
function timedBefore(bars: readonly RenderBar[], nextTime: number): readonly RenderBar[] {
  const newest = bars[bars.length - 1];
  if (newest === undefined || newest.time < nextTime) {
    return bars;
  }
  const shift = newest.time - nextTime + MINIMUM_BAR_GAP_SECONDS;
  return bars.map((bar) => ({ ...bar, time: bar.time - shift }));
}

/**
 * The bars a page of older ticks puts in front of a chart's own: the newest of them complete the oldest bar the
 * chart held short, so every bar added groups the interval's ticks and the chart's first bar joins them without a
 * seam. The ticks still short of a bar after that wait for the next older page.
 */
export function joinedTickBars(
  olderTicks: readonly IndicatorTick[],
  heldOldestTicks: readonly IndicatorTick[],
  ticksPerBar: number,
  oldestDrawnTime: number,
): TickBarHold {
  const joined = heldTickBars([...olderTicks, ...heldOldestTicks], ticksPerBar);
  return { bars: timedBefore(joined.bars, oldestDrawnTime), oldestTicks: joined.oldestTicks };
}
