import { expect, test } from '@playwright/test';
import { type AggregatedInterval, chartIntervalOf } from '../src/shared/bridge/chartIntervalModel';
import type { Candle } from '../src/shared/bridge/types';
import {
  aggregateCandles,
  aggregatedBlockStartMs,
  foldBaseCandle,
} from '../src/features/chart/engine/bars/aggregatedBars';

/**
 * The aggregation grid: which base candles one aggregated candle groups, what it keeps of them,
 * and how one live base candle folds into the forming aggregated candle.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const HOURS_PER_DAY = 24;
const MONTHS_PER_YEAR = 12;

/** 2026-03-10 00:00 on the broker's server clock, which these cases read as UTC. */
const DAY_START_MS = Date.UTC(2026, 2, 10);

/** The server-time midnight after {@link DAY_START_MS}, where the cases cross the day boundary. */
const NEXT_DAY_MS = DAY_START_MS + MS_PER_DAY;

/** The server-clock instant of `hour`:`minute` of the trading day starting at {@link DAY_START_MS}. */
function timeAt(hour: number, minute = 0): number {
  return DAY_START_MS + hour * MS_PER_HOUR + minute * MS_PER_MINUTE;
}

/** One base candle of a case: its open time, prices, tick volume, spread and real volume, in order. */
type BaseCandleRow = readonly [
  timeMs: number,
  open: string,
  high: string,
  low: string,
  close: string,
  tickVolume: number,
  spread: number,
  realVolume: number,
];

/** The base candle a row describes. */
function baseCandle(row: BaseCandleRow): Candle {
  const [timeMs, open, high, low, close, tickVolume, spread, realVolume] = row;
  return { timeMs, open, high, low, close, tickVolume, spread, realVolume };
}

/** The aggregated interval `code` names, failing the case when the model does not classify it as one. */
function aggregatedIntervalOf(code: string): AggregatedInterval {
  const interval = chartIntervalOf(code);
  if (interval?.kind !== 'aggregated') {
    throw new Error(`"${code}" should name an aggregated interval.`);
  }
  return interval;
}

const M7 = aggregatedIntervalOf('M7');
const H5 = aggregatedIntervalOf('H5');
const D5 = aggregatedIntervalOf('D5');
const W2 = aggregatedIntervalOf('W2');
const MN3 = aggregatedIntervalOf('MN3');
const MN4 = aggregatedIntervalOf('MN4');
const MN12 = aggregatedIntervalOf('MN12');

/** One aggregated candle's open time and prices, which most cases assert. */
type OhlcRow = readonly [timeMs: number, open: string, high: string, low: string, close: string];

/** The open time and prices of `candles`, in order. */
function ohlcOf(candles: readonly Candle[]): OhlcRow[] {
  return candles.map((candle): OhlcRow => [candle.timeMs, candle.open, candle.high, candle.low, candle.close]);
}

/** The tick volume, real volume and spread of `candles`, in order. */
function volumesOf(candles: readonly Candle[]): number[][] {
  return candles.map((candle) => [candle.tickVolume, candle.realVolume, candle.spread]);
}

/** `value` padded to two digits, so a price string can spell it. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A base candle opening at `timeMs` whose prices spell `stamp` — `1.1<stamp>00` and up — so an
 * aggregated block's open, high, low and close read back from the base candles it groups.
 */
function stampedCandle(timeMs: number, stamp: string, spread: number): Candle {
  const traded = Number(stamp) + 1;
  return baseCandle([
    timeMs,
    `1.1${stamp}00`,
    `1.1${stamp}50`,
    `1.0${stamp}50`,
    `1.1${stamp}20`,
    traded,
    spread,
    2 * traded,
  ]);
}

/**
 * Sixteen M1 candles of 2026-03-10, 10:00 to 10:15. Minute 600 is 85 seven-minute blocks (595
 * minutes) plus 5, so on the M7 grid — which counts from the server-time midnight — this window's
 * blocks open at 09:55, 10:02 and 10:09; the first one is short because the window starts inside
 * it. The high of 10:03, the low of 10:04, the high of 10:09 and the low of 10:10 are the extremes
 * of their blocks, each in the middle of the candles it groups.
 */
const M1_CANDLES: readonly Candle[] = [
  baseCandle([timeAt(10, 0), '1.10000', '1.10050', '1.09950', '1.10020', 10, 12, 2]),
  baseCandle([timeAt(10, 1), '1.10020', '1.10040', '1.09920', '1.09980', 11, 13, 3]),
  baseCandle([timeAt(10, 2), '1.09980', '1.10060', '1.09970', '1.10030', 12, 14, 4]),
  baseCandle([timeAt(10, 3), '1.10030', '1.10300', '1.10010', '1.10100', 13, 15, 5]),
  baseCandle([timeAt(10, 4), '1.10100', '1.10120', '1.09800', '1.09850', 14, 16, 6]),
  baseCandle([timeAt(10, 5), '1.09850', '1.09900', '1.09830', '1.09880', 15, 17, 7]),
  baseCandle([timeAt(10, 6), '1.09880', '1.09990', '1.09860', '1.09950', 16, 18, 8]),
  baseCandle([timeAt(10, 7), '1.09950', '1.10010', '1.09930', '1.09990', 17, 19, 9]),
  baseCandle([timeAt(10, 8), '1.09990', '1.10080', '1.09960', '1.10050', 18, 20, 10]),
  baseCandle([timeAt(10, 9), '1.10050', '1.10888', '1.10010', '1.10100', 19, 21, 11]),
  baseCandle([timeAt(10, 10), '1.10100', '1.10180', '1.09777', '1.10150', 20, 22, 12]),
  baseCandle([timeAt(10, 11), '1.10150', '1.10190', '1.10080', '1.10120', 21, 23, 13]),
  baseCandle([timeAt(10, 12), '1.10120', '1.10140', '1.10070', '1.10100', 22, 24, 14]),
  baseCandle([timeAt(10, 13), '1.10100', '1.10130', '1.09990', '1.10040', 23, 25, 15]),
  baseCandle([timeAt(10, 14), '1.10040', '1.10070', '1.10010', '1.10060', 24, 26, 16]),
  baseCandle([timeAt(10, 15), '1.10060', '1.10110', '1.10030', '1.10090', 25, 27, 17]),
];

/** The day's last M7 block — 23:55 to 23:59 — and the two candles that open the next day's grid. */
const MIDNIGHT_CANDLES: readonly Candle[] = [
  baseCandle([timeAt(23, 55), '1.10000', '1.10020', '1.09980', '1.10010', 1, 10, 1]),
  baseCandle([timeAt(23, 56), '1.10010', '1.10030', '1.09990', '1.10020', 2, 11, 2]),
  baseCandle([timeAt(23, 57), '1.10020', '1.10040', '1.10000', '1.10030', 3, 12, 3]),
  baseCandle([timeAt(23, 58), '1.10030', '1.10050', '1.10010', '1.10040', 4, 13, 4]),
  baseCandle([timeAt(23, 59), '1.10040', '1.10070', '1.10030', '1.10050', 5, 14, 5]),
  baseCandle([NEXT_DAY_MS, '1.10050', '1.10090', '1.10040', '1.10080', 6, 15, 6]),
  baseCandle([NEXT_DAY_MS + MS_PER_MINUTE, '1.10080', '1.10100', '1.10060', '1.10070', 7, 16, 7]),
];

/** Two M1 candles of the M7 block opening at 09:55: they trade at 10:00 and 10:01. */
const TEN_O_CLOCK = baseCandle([timeAt(10, 0), '1.10000', '1.10020', '1.09980', '1.10010', 10, 12, 4]);
const TEN_OH_ONE = baseCandle([timeAt(10, 1), '1.10010', '1.10030', '1.09990', '1.10020', 7, 13, 2]);

test.describe('the fixed grid', () => {
  test('a block start depends on the instant alone, never on what history was loaded', () => {
    expect(aggregatedBlockStartMs(M7, timeAt(10, 0))).toBe(timeAt(9, 55));
    expect(aggregatedBlockStartMs(M7, timeAt(10, 1))).toBe(timeAt(9, 55));
    expect(aggregatedBlockStartMs(M7, timeAt(10, 2))).toBe(timeAt(10, 2));
    expect(aggregatedBlockStartMs(H5, timeAt(23, 59))).toBe(timeAt(20));
    expect(aggregatedBlockStartMs(D5, Date.UTC(2026, 2, 10))).toBe(Date.UTC(2026, 2, 8));
    expect(aggregatedBlockStartMs(W2, Date.UTC(2026, 2, 11))).toBe(Date.UTC(2026, 2, 2));
    expect(aggregatedBlockStartMs(MN4, Date.UTC(2026, 11, 31))).toBe(Date.UTC(2026, 8, 1));
  });
});

test.describe('aggregating minutes onto the day grid', () => {
  test('M7 groups the ten o’clock M1 candles into blocks opening at 09:55, 10:02 and 10:09', () => {
    const aggregated = aggregateCandles(M1_CANDLES, M7);
    expect(ohlcOf(aggregated)).toEqual([
      [timeAt(9, 55), '1.10000', '1.10050', '1.09920', '1.09980'],
      [timeAt(10, 2), '1.09980', '1.10300', '1.09800', '1.10050'],
      [timeAt(10, 9), '1.10050', '1.10888', '1.09777', '1.10090'],
    ]);
  });

  test('volumes are summed and the spread is the block’s last base candle’s', () => {
    const aggregated = aggregateCandles(M1_CANDLES, M7);
    expect(volumesOf(aggregated)).toEqual([
      [21, 5, 13],
      [105, 49, 20],
      [154, 98, 27],
    ]);
  });

  test('an aggregated price is the string MT5 sent, never a formatted number', () => {
    const aggregated = aggregateCandles(M1_CANDLES, M7);
    expect(aggregated.map((candle) => candle.open)).toEqual(['1.10000', '1.09980', '1.10050']);
    expect(aggregated[1].high).toBe('1.10300');
    expect(aggregated[1].low).toBe('1.09800');
    expect(aggregated[2].high).toBe('1.10888');
    expect(aggregated[2].low).toBe('1.09777');
  });

  test('a base candle older than the one before it is ignored', () => {
    const inOrder = aggregateCandles([TEN_O_CLOCK, TEN_OH_ONE], M7);
    expect(aggregateCandles([TEN_O_CLOCK, TEN_OH_ONE, TEN_O_CLOCK], M7)).toEqual(inOrder);
  });

  test('an M7 block never straddles the server-time midnight', () => {
    const aggregated = aggregateCandles(MIDNIGHT_CANDLES, M7);
    expect(ohlcOf(aggregated)).toEqual([
      [timeAt(23, 55), '1.10000', '1.10070', '1.09980', '1.10050'],
      [NEXT_DAY_MS, '1.10050', '1.10100', '1.10040', '1.10070'],
    ]);
    expect(volumesOf(aggregated)).toEqual([
      [15, 15, 14],
      [13, 13, 16],
    ]);
  });
});

test.describe('aggregating hours onto the day grid', () => {
  /** The 24 hourly candles of {@link DAY_START_MS}, each priced by its hour. */
  function hourlyCandles(): Candle[] {
    const candles: Candle[] = [];
    for (let hour = 0; hour < HOURS_PER_DAY; hour += 1) {
      candles.push(stampedCandle(timeAt(hour), twoDigits(hour), 10 + hour));
    }
    return candles;
  }

  test('H5 opens blocks at 00:00, 05:00, 10:00, 15:00 and a short 20:00 block', () => {
    const aggregated = aggregateCandles(hourlyCandles(), H5);
    expect(ohlcOf(aggregated)).toEqual([
      [timeAt(0), '1.10000', '1.10450', '1.00050', '1.10420'],
      [timeAt(5), '1.10500', '1.10950', '1.00550', '1.10920'],
      [timeAt(10), '1.11000', '1.11450', '1.01050', '1.11420'],
      [timeAt(15), '1.11500', '1.11950', '1.01550', '1.11920'],
      [timeAt(20), '1.12000', '1.12350', '1.02050', '1.12320'],
    ]);
    // Five hours do not divide a day, so the last block holds only the hours 20:00 to 23:00.
    expect(volumesOf(aggregated)[4]).toEqual([90, 180, 33]);
  });
});

test.describe('aggregating days, weeks and months onto their epochs', () => {
  /** The daily candles of 2026-03-07 to 2026-03-13, each priced by its day of the month. */
  function marchCandles(): Candle[] {
    const candles: Candle[] = [];
    for (let day = 7; day <= 13; day += 1) {
      candles.push(stampedCandle(Date.UTC(2026, 2, day), twoDigits(day), 200 + day));
    }
    return candles;
  }

  /** The month-start candles of `year`, each priced by its month number. */
  function monthCandlesOf(year: number): Candle[] {
    const candles: Candle[] = [];
    for (let month1 = 1; month1 <= MONTHS_PER_YEAR; month1 += 1) {
      candles.push(stampedCandle(Date.UTC(year, month1 - 1, 1), twoDigits(month1), 100 + month1));
    }
    return candles;
  }

  test('D5 counts five-day blocks from 1970-01-01', () => {
    // 2026-03-10 is day 20522 since 1970-01-01: 56 years with 14 leap days (1972…2024) make
    // 56 * 365 + 14 = 20454 days to 2026-01-01, plus 31 (January) + 28 (February) + 9 = 68 days.
    // floor(20522 / 5) * 5 = 20520, so its block opened on day 20520 = 2026-03-08 and the next
    // block opens on day 20525 = 2026-03-13.
    const aggregated = aggregateCandles(marchCandles(), D5);
    expect(ohlcOf(aggregated)).toEqual([
      [Date.UTC(2026, 2, 3), '1.10700', '1.10750', '1.00750', '1.10720'],
      [Date.UTC(2026, 2, 8), '1.10800', '1.11250', '1.00850', '1.11220'],
      [Date.UTC(2026, 2, 13), '1.11300', '1.11350', '1.01350', '1.11320'],
    ]);
    expect(volumesOf(aggregated)[1]).toEqual([55, 110, 212]);
  });

  test('W2 counts two-week blocks from Monday 1970-01-05', () => {
    // 2026-03-02 is day 20514 since 1970-01-01, and (20514 - 4) / 7 = 2930 whole weeks after
    // Monday 1970-01-05 (day 4). Block 2930 is even, so it opens on 2026-03-02 and holds the week
    // of 2026-03-09 too; week 2932 opens the next block, on 2026-03-16.
    const mondays = [2, 9, 16].map((day) => stampedCandle(Date.UTC(2026, 2, day), twoDigits(day), 300 + day));
    expect(ohlcOf(aggregateCandles(mondays, W2))).toEqual([
      [Date.UTC(2026, 2, 2), '1.10200', '1.10950', '1.00250', '1.10920'],
      [Date.UTC(2026, 2, 16), '1.11600', '1.11650', '1.01650', '1.11620'],
    ]);
  });

  test('MN4 opens its blocks in January, May and September', () => {
    const aggregated = aggregateCandles(monthCandlesOf(2026), MN4);
    expect(aggregated.map((candle) => candle.timeMs)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 4, 1),
      Date.UTC(2026, 8, 1),
    ]);
    // The September block holds the stamps '09', '10', '11' and '12', so stampedCandle gives it
    // opens 1.10900 … 1.11200, highs 1.10950 … 1.11250 and lows 1.00950 … 1.01250: the block opens
    // on the first candle's open, peaks at the largest high, bottoms at the smallest low and closes
    // on the last candle's close.
    expect(ohlcOf(aggregated)[2]).toEqual([Date.UTC(2026, 8, 1), '1.10900', '1.11250', '1.00950', '1.11220']);
    // Those four candles trade 10, 11, 12 and 13 ticks (the stamp plus one) and twice that as real
    // volume, which the block sums; its spread is the last candle's, 100 + 12.
    expect(volumesOf(aggregated)[2]).toEqual([46, 92, 112]);
  });

  test('an MN4 block does not straddle the year boundary: December closes the September block', () => {
    const december = stampedCandle(Date.UTC(2026, 11, 1), twoDigits(12), 112);
    const january = stampedCandle(Date.UTC(2027, 0, 1), twoDigits(1), 101);
    expect(aggregateCandles([december, january], MN4).map((candle) => candle.timeMs)).toEqual([
      Date.UTC(2026, 8, 1),
      Date.UTC(2027, 0, 1),
    ]);
  });

  test('MN3 opens its blocks in January, April, July and October', () => {
    expect(aggregateCandles(monthCandlesOf(2026), MN3).map((candle) => candle.timeMs)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 3, 1),
      Date.UTC(2026, 6, 1),
      Date.UTC(2026, 9, 1),
    ]);
  });

  test('MN12 opens a single block in January', () => {
    const aggregated = aggregateCandles(monthCandlesOf(2026), MN12);
    // With the stamps '01' … '12' stampedCandle keeps every candle inside this one block: January
    // opens it at 1.10100 and carries the smallest low, 1.00150, while December carries the largest
    // high, 1.11250, and the last close, 1.11220.
    expect(ohlcOf(aggregated)).toEqual([[Date.UTC(2026, 0, 1), '1.10100', '1.11250', '1.00150', '1.11220']]);
    // The twelve candles trade 2 + 3 + … + 13 = 90 ticks and twice that as real volume, and the
    // block's spread is December's, 100 + 12.
    expect(volumesOf(aggregated)).toEqual([[90, 180, 112]]);
  });
});

test.describe('folding one live base candle into the forming aggregated candle', () => {
  test('a live update of the newest base candle replaces it instead of counting it twice', () => {
    const opened = foldBaseCandle([], TEN_O_CLOCK, M7, []);
    const twoBars = foldBaseCandle(opened.candles, TEN_OH_ONE, M7, opened.baseInBlock);
    expect(twoBars.baseInBlock).toEqual([TEN_O_CLOCK, TEN_OH_ONE]);

    const liveUpdate = { ...TEN_OH_ONE, high: '1.10060', close: '1.10050', tickVolume: 9 };
    const updated = foldBaseCandle(twoBars.candles, liveUpdate, M7, twoBars.baseInBlock);
    expect(updated.candles).toEqual([
      {
        timeMs: timeAt(9, 55),
        open: '1.10000',
        high: '1.10060',
        low: '1.09980',
        close: '1.10050',
        tickVolume: 19,
        spread: 13,
        realVolume: 6,
      },
    ]);
    expect(updated.baseInBlock).toEqual([TEN_O_CLOCK, liveUpdate]);
  });

  test('a base candle of a newer block opens an aggregated candle', () => {
    const forming = aggregateCandles([TEN_O_CLOCK, TEN_OH_ONE], M7);
    const atTenOhTwo = baseCandle([timeAt(10, 2), '1.10020', '1.10040', '1.10000', '1.10030', 5, 14, 1]);
    const folded = foldBaseCandle(forming, atTenOhTwo, M7, [TEN_O_CLOCK, TEN_OH_ONE]);
    expect(folded.candles).toEqual([
      forming[0],
      {
        timeMs: timeAt(10, 2),
        open: '1.10020',
        high: '1.10040',
        low: '1.10000',
        close: '1.10030',
        tickVolume: 5,
        spread: 14,
        realVolume: 1,
      },
    ]);
    expect(folded.baseInBlock).toEqual([atTenOhTwo]);
  });

  test('a base candle of an older block is ignored', () => {
    const forming = aggregateCandles([TEN_O_CLOCK, TEN_OH_ONE], M7);
    const earlier = baseCandle([timeAt(9, 0), '1.09000', '1.09010', '1.08990', '1.09005', 3, 9, 1]);
    const folded = foldBaseCandle(forming, earlier, M7, [TEN_O_CLOCK, TEN_OH_ONE]);
    expect(folded.candles).toEqual(forming);
    expect(folded.baseInBlock).toEqual([TEN_O_CLOCK, TEN_OH_ONE]);
  });
});
