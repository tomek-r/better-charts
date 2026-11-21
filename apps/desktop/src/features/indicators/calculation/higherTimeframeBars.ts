import { timeframeBarTime, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { RenderBar } from '../../chart/engine/bars/renderBar';

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
