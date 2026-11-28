/**
 * The fixed aggregation grid and the candles it builds from a native timeframe's bars.
 *
 * The grid never shifts, so a base candle falls into the same aggregated candle however often
 * history is reloaded: minute and hour blocks count from the server-time midnight of the candle's
 * day, day blocks from 1970-01-01, week blocks from Monday 1970-01-05 and month blocks from
 * January of year zero.
 */
import type { AggregatedInterval } from '../../../../shared/bridge/chartIntervalModel';
import type { Candle } from '../../../../shared/bridge/types';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** 1970-01-01 00:00: the day blocks count from. */
const DAY_EPOCH_MS = Date.UTC(1970, 0, 1);

/** Monday 1970-01-05 00:00: the first whole week, which the week blocks count from. */
const WEEK_EPOCH_MS = Date.UTC(1970, 0, 5);

const MONTHS_PER_YEAR = 12;

/** The start of the block of `interval` that `timeMs` falls in. */
export function aggregatedBlockStartMs(interval: AggregatedInterval, timeMs: number): number {
  switch (interval.unit) {
    case 'M':
      return countedBlockStartMs(timeMs, dayStartMsOf(timeMs), interval.count * MS_PER_MINUTE);
    case 'H':
      return countedBlockStartMs(timeMs, dayStartMsOf(timeMs), interval.count * MS_PER_HOUR);
    case 'D':
      return countedBlockStartMs(timeMs, DAY_EPOCH_MS, interval.count * MS_PER_DAY);
    case 'W':
      return countedBlockStartMs(timeMs, WEEK_EPOCH_MS, interval.count * MS_PER_WEEK);
    case 'MN':
      return monthBlockStartMs(timeMs, interval.count);
  }
}

/** The aggregated candles of `baseCandles` (oldest first), one per block holding a base candle. */
export function aggregateCandles(baseCandles: readonly Candle[], interval: AggregatedInterval): Candle[] {
  return blocksOf(baseCandles, interval).map((baseInBlock) => candleOfBlock(interval, baseInBlock));
}

/**
 * `aggregated` and its forming block after folding one live `baseCandle`. The forming block is
 * rebuilt from its base candles, so a live update replaces the base candle of its own time instead
 * of counting it twice; a base candle of a newer block opens an aggregated candle, and one of an
 * older block is ignored. `baseInBlock` is the forming block's base candles, as the previous fold
 * or the newest block of {@link aggregateCandles} left them.
 */
export function foldBaseCandle(
  aggregated: readonly Candle[],
  baseCandle: Candle,
  interval: AggregatedInterval,
  baseInBlock: readonly Candle[],
): { candles: Candle[]; baseInBlock: Candle[] } {
  const blockStartMs = aggregatedBlockStartMs(interval, baseCandle.timeMs);
  const forming = aggregated[aggregated.length - 1];
  if (forming === undefined || blockStartMs > forming.timeMs) {
    return { candles: [...aggregated, candleOfBlock(interval, [baseCandle])], baseInBlock: [baseCandle] };
  }
  if (blockStartMs < forming.timeMs) {
    return { candles: [...aggregated], baseInBlock: [...baseInBlock] };
  }
  const mergedBlock = mergeBaseCandle(baseInBlock, baseCandle);
  if (mergedBlock === undefined) {
    return { candles: [...aggregated], baseInBlock: [...baseInBlock] };
  }
  return { candles: [...aggregated.slice(0, -1), candleOfBlock(interval, mergedBlock)], baseInBlock: mergedBlock };
}

/** The base candles grouped into their grid blocks, oldest block first. */
function blocksOf(baseCandles: readonly Candle[], interval: AggregatedInterval): Candle[][] {
  const blocks: Candle[][] = [];
  let currentBlockStartMs: number | undefined;
  let newestKeptTimeMs = Number.NEGATIVE_INFINITY;
  for (const baseCandle of baseCandles) {
    if (baseCandle.timeMs < newestKeptTimeMs) {
      continue;
    }
    newestKeptTimeMs = baseCandle.timeMs;
    const blockStartMs = aggregatedBlockStartMs(interval, baseCandle.timeMs);
    if (blockStartMs === currentBlockStartMs) {
      blocks[blocks.length - 1].push(baseCandle);
      continue;
    }
    currentBlockStartMs = blockStartMs;
    blocks.push([baseCandle]);
  }
  return blocks;
}

/**
 * The base candles of the forming block with `baseCandle` in place of the candle of its own time,
 * or appended when it is newer; undefined when it is older than the block's newest candle.
 */
function mergeBaseCandle(baseInBlock: readonly Candle[], baseCandle: Candle): Candle[] | undefined {
  const sameTime = baseInBlock.findIndex((base) => base.timeMs === baseCandle.timeMs);
  if (sameTime !== -1) {
    return baseInBlock.map((base, index) => (index === sameTime ? baseCandle : base));
  }
  const newest = baseInBlock[baseInBlock.length - 1];
  if (newest === undefined || baseCandle.timeMs > newest.timeMs) {
    return [...baseInBlock, baseCandle];
  }
  return undefined;
}

/** The aggregated candle a block's base candles make: prices stay the exact strings MT5 sent. */
function candleOfBlock(interval: AggregatedInterval, baseInBlock: readonly Candle[]): Candle {
  const oldest = baseInBlock[0];
  const newest = baseInBlock[baseInBlock.length - 1];
  return {
    timeMs: aggregatedBlockStartMs(interval, oldest.timeMs),
    open: oldest.open,
    high: extremePriceOf(
      baseInBlock,
      (baseCandle) => baseCandle.high,
      (candidate, best) => candidate > best,
    ),
    low: extremePriceOf(
      baseInBlock,
      (baseCandle) => baseCandle.low,
      (candidate, best) => candidate < best,
    ),
    close: newest.close,
    tickVolume: sumOf(baseInBlock, (baseCandle) => baseCandle.tickVolume),
    spread: newest.spread,
    realVolume: sumOf(baseInBlock, (baseCandle) => baseCandle.realVolume),
  };
}

/** The price string the comparison keeps, so an aggregated high or low is never reformatted. */
function extremePriceOf(
  baseInBlock: readonly Candle[],
  priceOf: (baseCandle: Candle) => string,
  keeps: (candidate: number, best: number) => boolean,
): string {
  let bestPrice = priceOf(baseInBlock[0]);
  for (const baseCandle of baseInBlock) {
    const price = priceOf(baseCandle);
    if (keeps(Number(price), Number(bestPrice))) {
      bestPrice = price;
    }
  }
  return bestPrice;
}

/** The sum of the `volumeOf` volume over the block's base candles. */
function sumOf(baseInBlock: readonly Candle[], volumeOf: (baseCandle: Candle) => number): number {
  return baseInBlock.reduce((total, baseCandle) => total + volumeOf(baseCandle), 0);
}

/** The start of the `blockMs` block `timeMs` falls in, counted from `originMs`. */
function countedBlockStartMs(timeMs: number, originMs: number, blockMs: number): number {
  return originMs + Math.floor((timeMs - originMs) / blockMs) * blockMs;
}

/** The server-time midnight of `timeMs`'s day: the grid of minutes and hours restarts there. */
function dayStartMsOf(timeMs: number): number {
  return countedBlockStartMs(timeMs, DAY_EPOCH_MS, MS_PER_DAY);
}

/** The start of the block of `count` calendar months `timeMs` falls in: 3M opens Jan, Apr, Jul, Oct. */
function monthBlockStartMs(timeMs: number, count: number): number {
  return monthStartMsOf(Math.floor(monthIndexOf(timeMs) / count) * count);
}

/** The months between January of year zero and the month `timeMs` falls in, read as UTC. */
function monthIndexOf(timeMs: number): number {
  const instant = new Date(timeMs);
  return instant.getUTCFullYear() * MONTHS_PER_YEAR + instant.getUTCMonth();
}

/** The instant the first day of month `monthIndex` starts, at the server-time midnight. */
function monthStartMsOf(monthIndex: number): number {
  const year = Math.floor(monthIndex / MONTHS_PER_YEAR);
  return Date.UTC(year, monthIndex - year * MONTHS_PER_YEAR, 1);
}
