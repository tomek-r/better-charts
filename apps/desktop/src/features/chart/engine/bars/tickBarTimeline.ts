import type { TickGrouping } from '../../../../shared/bridge/chartIntervals';
import type { IndicatorTick } from '../../../../shared/bridge/types';
import { buildTickBars, tickPrice } from '../../../indicators/calculation/tickBars';
import type { RenderBar } from './renderBar';

const MILLISECONDS_PER_SECOND = 1000;

/** The seconds of a broker day: a seconds interval's block grid counts from each day's own start. */
const SECONDS_PER_DAY = 86_400;

/**
 * The chart library refuses equal times, so two N-tick bars whose ticks all
 * arrived within one second are drawn a second apart: the times are there to
 * order the bars, not to place them on the broker's clock. A seconds bar needs
 * none of that, because its block start already is its own.
 */
const MINIMUM_BAR_GAP_SECONDS = 1;

/** Tick-built bars as a chart can draw them, and the ticks of the bar still forming. */
export interface TickBarTimeline {
  /** Every bar built so far, oldest first, with strictly increasing times. */
  readonly bars: readonly RenderBar[];
  /**
   * Prices the newest bar groups so far, oldest first; empty once its last tick closed
   * it, and always empty for a seconds interval, whose block closes on the clock.
   */
  readonly formingPrices: readonly number[];
}

/** The bars a chart's tick read draws, and the ticks an older page completes before they become a bar. */
export interface TickBarHold {
  /** The bars to draw, oldest first: each holds the ticks of one group or block of its interval. */
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

/** The broker second an instant of epoch milliseconds falls in. */
function tickSecondsOf(timeMs: number): number {
  return Math.floor(timeMs / MILLISECONDS_PER_SECOND);
}

/**
 * The start of the `secondsPerBar` block holding `tickSeconds`, counted from the start of the
 * tick's own broker day: the grid never shifts when older history loads, and a day's last
 * block may be shorter than its interval.
 */
function blockStartSeconds(tickSeconds: number, secondsPerBar: number): number {
  const dayStart = Math.floor(tickSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  return dayStart + Math.floor((tickSeconds - dayStart) / secondsPerBar) * secondsPerBar;
}

/** The N-tick timeline `ticks` build, timed so the chart accepts it. */
function tickGroupTimelineOf(ticks: readonly IndicatorTick[], ticksPerBar: number): TickBarTimeline {
  const series = buildTickBars(ticks, ticksPerBar);
  const bars: RenderBar[] = [];
  for (const bar of series.bars) {
    bars.push({ ...bar, time: barTimeAfter(bars[bars.length - 1]?.time, bar.time) });
  }
  return { bars, formingPrices: series.formingPrices };
}

/** Folds a tick of `blockStart` into the seconds bars `bars`: a newer block opens a bar, its own extends it. */
function extendSecondBars(bars: RenderBar[], blockStart: number, price: number): void {
  const newest = bars[bars.length - 1];
  if (newest === undefined || blockStart > newest.time) {
    bars.push(openedBar(blockStart, price));
    return;
  }
  if (blockStart === newest.time) {
    bars[bars.length - 1] = extendedBar(newest, price);
  }
}

/** The bars `ticks` build on the block grid of `secondsPerBar` seconds. */
function secondGroupBarsOf(ticks: readonly IndicatorTick[], secondsPerBar: number): readonly RenderBar[] {
  const bars: RenderBar[] = [];
  if (secondsPerBar < 1) {
    return bars;
  }
  for (const tick of ticks) {
    const price = tickPrice(tick);
    if (price !== null) {
      extendSecondBars(bars, blockStartSeconds(tickSecondsOf(tick.timeMs), secondsPerBar), price);
    }
  }
  return bars;
}

/** The bars `ticks` build for `grouping`, in the order they arrived and timed so the chart accepts them. */
export function tickBarTimeline(ticks: readonly IndicatorTick[], grouping: TickGrouping): TickBarTimeline {
  if (grouping.kind === 'seconds') {
    // A block start is strictly increasing by construction, so the clock alone times its bar.
    return { bars: secondGroupBarsOf(ticks, grouping.seconds), formingPrices: [] };
  }
  return tickGroupTimelineOf(ticks, grouping.ticksPerBar);
}

/**
 * The timeline with one more tick folded in: into the newest bar while it is still
 * forming, or into a bar of its own once the newest one holds every tick it groups.
 * A seconds tick folds into the block it falls in, and a tick carrying no price
 * leaves the timeline as it was.
 */
export function foldTick(timeline: TickBarTimeline, tick: IndicatorTick, grouping: TickGrouping): TickBarTimeline {
  const price = tickPrice(tick);
  if (price === null) {
    return timeline;
  }
  if (grouping.kind === 'seconds') {
    return foldSecondTick(timeline, tick, price, grouping.seconds);
  }
  return foldTickGroupTick(timeline, tick, price, grouping.ticksPerBar);
}

/** The timeline with one more tick folded into the N-tick bar it belongs to. */
function foldTickGroupTick(
  timeline: TickBarTimeline,
  tick: IndicatorTick,
  price: number,
  ticksPerBar: number,
): TickBarTimeline {
  if (ticksPerBar < 1) {
    return timeline;
  }
  if (timeline.formingPrices.length === 0) {
    const time = barTimeAfter(timeline.bars[timeline.bars.length - 1]?.time, tickSecondsOf(tick.timeMs));
    return { bars: [...timeline.bars, openedBar(time, price)], formingPrices: [price] };
  }
  const bars = [...timeline.bars];
  const newest = bars.length - 1;
  bars[newest] = extendedBar(bars[newest], price);
  const formingPrices = [...timeline.formingPrices, price];
  return { bars, formingPrices: formingPrices.length >= ticksPerBar ? [] : formingPrices };
}

/**
 * The timeline with one more tick folded into the block it falls in: the newest bar while
 * the tick's block is that bar's own, else a bar opened at the tick's block start. A tick
 * whose block is older than the newest bar is ignored, so history is never rewritten.
 */
function foldSecondTick(
  timeline: TickBarTimeline,
  tick: IndicatorTick,
  price: number,
  secondsPerBar: number,
): TickBarTimeline {
  if (secondsPerBar < 1) {
    return timeline;
  }
  const blockStart = blockStartSeconds(tickSecondsOf(tick.timeMs), secondsPerBar);
  const newest = timeline.bars[timeline.bars.length - 1];
  if (newest !== undefined && blockStart < newest.time) {
    return timeline;
  }
  const bars = [...timeline.bars];
  extendSecondBars(bars, blockStart, price);
  return { bars, formingPrices: [] };
}

/** How many of `priced`'s leading ticks fall in the block of its oldest tick. */
function ticksInOldestBlock(priced: readonly IndicatorTick[], secondsPerBar: number): number {
  const oldestBlock = blockStartSeconds(tickSecondsOf(priced[0].timeMs), secondsPerBar);
  const outside = priced.findIndex(
    (tick) => blockStartSeconds(tickSecondsOf(tick.timeMs), secondsPerBar) !== oldestBlock,
  );
  return outside === -1 ? priced.length : outside;
}

/** The seconds bars a read draws, and the ticks of its oldest block, which a read starting mid-block leaves short. */
function heldSecondBars(priced: readonly IndicatorTick[], secondsPerBar: number): TickBarHold {
  if (secondsPerBar < 1 || priced.length === 0) {
    return { bars: [], oldestTicks: [] };
  }
  const heldCount = ticksInOldestBlock(priced, secondsPerBar);
  return { bars: secondGroupBarsOf(priced.slice(heldCount), secondsPerBar), oldestTicks: priced.slice(0, heldCount) };
}

/**
 * The bars a read's ticks build for the chart, grouped from the newest tick back so every bar it draws holds the
 * ticks its interval groups: a read starts mid-stream, so the ticks short of a bar — or of a seconds block — are
 * its oldest ones, which an older page completes.
 */
export function heldTickBars(ticks: readonly IndicatorTick[], grouping: TickGrouping): TickBarHold {
  const priced = pricedTicks(ticks);
  if (grouping.kind === 'seconds') {
    return heldSecondBars(priced, grouping.seconds);
  }
  if (grouping.ticksPerBar < 1) {
    return { bars: [], oldestTicks: [] };
  }
  const shortOfBar = priced.length % grouping.ticksPerBar;
  const { bars } = tickBarTimeline(priced.slice(shortOfBar), grouping);
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
  grouping: TickGrouping,
  oldestDrawnTime: number,
): TickBarHold {
  const joined = heldTickBars([...olderTicks, ...heldOldestTicks], grouping);
  if (grouping.kind === 'seconds') {
    // A seconds block sits on a fixed grid, so one the chart already draws from cannot be moved: it is dropped.
    return { bars: joined.bars.filter((bar) => bar.time < oldestDrawnTime), oldestTicks: joined.oldestTicks };
  }
  return { bars: timedBefore(joined.bars, oldestDrawnTime), oldestTicks: joined.oldestTicks };
}
