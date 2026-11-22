import { timeframeBarTime, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { RenderBar } from '../../chart/engine/bars/renderBar';
import { NO_FRAME_BAR } from '../indicatorFrameBars';

/** The chart's bars grouped into a higher timeframe's bars, and the bucket each chart bar falls in. */
export interface HigherTimeframeBars {
  /** One bar per higher-timeframe candle, oldest first; the last one is forming while the chart's last bar is. */
  readonly bars: readonly RenderBar[];
  /** For every chart bar, the index in `bars` of the higher-timeframe bar it falls in. */
  readonly bucketOf: readonly number[];
}

const SECONDS_PER_DAY = 86_400;
const DAYS_PER_WEEK = 7;
/** 1970-01-01 was a Thursday, three days after the Monday that opened its week. */
const DAYS_FROM_MONDAY_TO_EPOCH = 3;
const MILLISECONDS_PER_SECOND = 1000;

/** The first instant of the month `timeSeconds` falls in, in the UTC calendar the bar times are written in. */
function monthStart(timeSeconds: number): number {
  const time = new Date(timeSeconds * MILLISECONDS_PER_SECOND);
  return Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1) / MILLISECONDS_PER_SECOND;
}

/** The midnight that opened the Monday of the week `timeSeconds` falls in. */
function weekStart(timeSeconds: number): number {
  const dayStart = timeSeconds - (timeSeconds % SECONDS_PER_DAY);
  const daysSinceMonday = (dayStart / SECONDS_PER_DAY + DAYS_FROM_MONDAY_TO_EPOCH) % DAYS_PER_WEEK;
  return dayStart - daysSinceMonday * SECONDS_PER_DAY;
}

/**
 * The time of the higher-timeframe bar `timeSeconds` falls in, on the timeframe's own calendar grid: the
 * period the timeframe steps by for the intraday timeframes and D1, the Monday of its week for W1 and the
 * first of its month for MN1.
 */
export function higherTimeframeBarTime(wire: string, timeSeconds: number): number {
  if (wire === 'MN1') {
    return monthStart(timeSeconds);
  }
  if (wire === 'W1') {
    return weekStart(timeSeconds);
  }
  const seconds = timeframeSeconds(wire);
  return timeframeBarTime(wire, 0, Math.floor(timeSeconds / seconds));
}

/** The bucket its first chart bar opens: its prices and volume are that one bar's until another joins it. */
function openingBucket(start: number, bar: RenderBar): RenderBar {
  return { time: start, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
}

/** The bucket so far, grown by one more chart bar that closed inside it. */
function extendedBucket(bucket: RenderBar, bar: RenderBar): RenderBar {
  return {
    time: bucket.time,
    open: bucket.open,
    high: Math.max(bucket.high, bar.high),
    low: Math.min(bucket.low, bar.low),
    close: bar.close,
    volume: bucket.volume + bar.volume,
  };
}

/**
 * Groups the chart's `bars` into `wire`'s bars: every higher-timeframe bar takes the first open, the highest
 * high, the lowest low, the last close and the summed volume of the chart bars that fall in it.
 */
export function bucketBars(bars: readonly RenderBar[], wire: string): HigherTimeframeBars {
  const buckets: RenderBar[] = [];
  const bucketOf: number[] = [];
  for (const bar of bars) {
    const start = higherTimeframeBarTime(wire, bar.time);
    const current = buckets.at(-1);
    if (current === undefined || current.time !== start) {
      buckets.push(openingBucket(start, bar));
    } else {
      buckets[buckets.length - 1] = extendedBucket(current, bar);
    }
    bucketOf.push(buckets.length - 1);
  }
  return { bars: buckets, bucketOf };
}

/** Where the newest higher-timeframe bar opens in `bars`: the first chart bar of its bucket. */
export function newestBucketIndex(bars: readonly RenderBar[], wire: string): number {
  const newest = bars.at(-1);
  if (newest === undefined) {
    return 0;
  }
  const start = higherTimeframeBarTime(wire, newest.time);
  return bars.findIndex((bar) => higherTimeframeBarTime(wire, bar.time) === start);
}

/** The higher-timeframe bar the newest chart bars form so far: the one the chart is still drawing into. */
export function formingBucketBar(bars: readonly RenderBar[], wire: string): RenderBar | undefined {
  const from = newestBucketIndex(bars, wire);
  const newestBucket = bucketBars(bars.slice(from), wire).bars;
  return newestBucket.at(0);
}

/** For every chart bar, the index into `bars` of the bucket it falls in, `NO_FRAME_BAR` while there is none. */
export function bucketIndexesOf(
  bars: readonly RenderBar[],
  wire: string,
  chartBars: readonly RenderBar[],
): readonly number[] {
  const indexOfStart = new Map(bars.map((bar, index): [number, number] => [bar.time, index]));
  return chartBars.map((bar) => indexOfStart.get(higherTimeframeBarTime(wire, bar.time)) ?? NO_FRAME_BAR);
}

/**
 * `bars` with the newest bucket taken from the chart's own bars, so a live tick moves it as grouping does: the
 * bucket is replaced when the series holds it, and appended when the chart has opened one the series has not.
 */
export function withFormingBucket(
  bars: readonly RenderBar[],
  chartBars: readonly RenderBar[],
  wire: string,
): readonly RenderBar[] {
  const forming = formingBucketBar(chartBars, wire);
  const newest = bars.at(-1);
  if (forming === undefined) {
    return bars;
  }
  if (newest === undefined || forming.time > newest.time) {
    return [...bars, forming];
  }
  return newest.time === forming.time ? [...bars.slice(0, -1), forming] : bars;
}
