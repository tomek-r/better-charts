import { expect, test } from '@playwright/test';
import type { FootprintSide } from '../src/features/chart/engine/barStyle/volumeFootprint/footprintShades';
import {
  footprintStackedZones,
  type FootprintZoneBar,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintStackedZones';
import type {
  BarFootprint,
  ChartFootprintRow,
} from '../src/features/chart/engine/barStyle/volumeFootprint/footprintData';

/**
 * What a run of consecutive imbalanced rows of one bar makes: a zone that spans the run's prices and lasts until the
 * first later bar whose own range overlaps it. Every price below is hand-computed from a ladder of quarter-high rows
 * starting at 1.5, which is exact in binary, so a zone is asserted with the prices its rows carry.
 */

/** The row height of the fixture ladder, and the down price its lowest row starts at. */
const ROW_HEIGHT = 0.25;
const LOWEST_ROW_DOWN_PRICE = 1.5;
/** A bar's time, which no assertion reads: a zone is placed by its bar's index, not by a time. */
const BAR_OPEN_MS = 1_700_000_000_000;

/** The prices of one row of the ladder: a quarter above the price its number names. */
function levelPrices(rowNumber: number): { downPrice: number; upPrice: number } {
  const downPrice = LOWEST_ROW_DOWN_PRICE + rowNumber * ROW_HEIGHT;
  return { downPrice, upPrice: downPrice + ROW_HEIGHT };
}

/** One footprint row of the ladder, flagged on the sides given and on no other. */
function row(rowNumber: number, sides: readonly FootprintSide[]): ChartFootprintRow {
  return {
    row: rowNumber,
    ...levelPrices(rowNumber),
    buyVolume: 100,
    sellVolume: 100,
    buyTrades: 10,
    sellTrades: 10,
    buyImbalance: sides.includes('buy'),
    sellImbalance: sides.includes('sell'),
  };
}

/** One bar's footprint over `rows`, with the bar sums a zone never reads. */
function footprintOf(rows: readonly ChartFootprintRow[]): BarFootprint {
  return {
    openMs: BAR_OPEN_MS,
    rows: [...rows],
    buyVolume: 0,
    sellVolume: 0,
    buyTrades: 0,
    sellTrades: 0,
    poc: null,
    vah: null,
    val: null,
    volume: 'real',
  };
}

/** One bar of the series the zones are computed over: the range its candle spans and the rows it traded. */
function zoneBar(low: number, high: number, rows?: readonly ChartFootprintRow[]): FootprintZoneBar {
  return rows === undefined ? { low, high } : { low, high, footprint: footprintOf(rows) };
}

/** A bar of no footprint, so it ends a zone by its range alone. */
function quietBar(low: number, high: number): FootprintZoneBar {
  return zoneBar(low, high);
}

/** Three consecutive buy-imbalanced rows of one bar, from 1.5 up to 2.25. */
const THREE_BUY_ROWS: readonly ChartFootprintRow[] = [row(0, ['buy']), row(1, ['buy']), row(2, ['buy'])];

test('three consecutive buy rows of one bar form a zone from their lowest down price to their highest up price', () => {
  const zones = footprintStackedZones([zoneBar(1.5, 2.25, THREE_BUY_ROWS)], 3);

  expect(zones).toEqual([{ startIndex: 0, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2.25 }]);
});

test('two consecutive rows of one side do not stack into a zone of three', () => {
  const zones = footprintStackedZones([zoneBar(1.5, 2, [row(0, ['buy']), row(1, ['buy'])])], 3);

  expect(zones).toEqual([]);
});

test('a row of the same side that is not consecutive breaks the run in two', () => {
  // The middle row of the ladder is flagged on neither side, so the rows around it never stack.
  const unmarkedInBetween = [row(0, ['buy']), row(1, []), row(2, ['buy'])];
  // The middle level is missing from the bar altogether, which breaks the run by its own row number.
  const missingLevel = [row(0, ['buy']), row(2, ['buy']), row(3, ['buy'])];

  expect(footprintStackedZones([zoneBar(1.5, 2.25, unmarkedInBetween)], 2)).toEqual([]);
  // The two rows above the gap are consecutive, so they stack at two and not at three.
  expect(footprintStackedZones([zoneBar(1.5, 2.5, missingLevel)], 3)).toEqual([]);
  expect(footprintStackedZones([zoneBar(1.5, 2.5, missingLevel)], 2)).toEqual([
    { startIndex: 0, endIndex: null, side: 'buy', downPrice: 2, upPrice: 2.5 },
  ]);
});

test('the sell and buy runs of one bar form a zone each, the sell side first', () => {
  const rows = [
    row(0, ['sell']),
    row(1, ['sell']),
    row(2, ['sell']),
    row(3, []),
    row(4, ['buy']),
    row(5, ['buy']),
    row(6, ['buy']),
  ];

  const zones = footprintStackedZones([zoneBar(1.5, 3.25, rows)], 3);

  expect(zones).toEqual([
    { startIndex: 0, endIndex: null, side: 'sell', downPrice: 1.5, upPrice: 2.25 },
    { startIndex: 0, endIndex: null, side: 'buy', downPrice: 2.5, upPrice: 3.25 },
  ]);
});

test('a row flagged on both sides stacks into a zone of each side', () => {
  const bars = [zoneBar(1.5, 2.5, [row(0, ['buy', 'sell']), row(1, ['buy', 'sell']), row(2, [])])];

  const zones = footprintStackedZones(bars, 2);

  expect(zones).toEqual([
    { startIndex: 0, endIndex: null, side: 'sell', downPrice: 1.5, upPrice: 2 },
    { startIndex: 0, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2 },
  ]);
});

test('a zone ends at the first later bar whose range overlaps it', () => {
  const bars = [zoneBar(1.5, 2.25, THREE_BUY_ROWS), quietBar(1.4, 1.6), quietBar(1.5, 2.25)];

  const zones = footprintStackedZones(bars, 3);

  expect(zones).toEqual([{ startIndex: 0, endIndex: 1, side: 'buy', downPrice: 1.5, upPrice: 2.25 }]);
});

test('a later bar that only touches a zone edge ends it, and one that clears the zone does not', () => {
  // The zone spans 1.5 to 2.25, so a bar starting on either one of those prices meets it.
  const bars = [zoneBar(1.5, 2.25, THREE_BUY_ROWS), quietBar(2.5, 2.75), quietBar(2.25, 2.5), quietBar(1.5, 1.6)];

  const zones = footprintStackedZones(bars, 3);

  expect(zones[0]?.endIndex).toBe(2);
});

test('a zone no later bar touches stays open to the pane edge', () => {
  // Both later bars stay above the zone; the third carries no prices at all, as a bar with no close does.
  const bars = [
    zoneBar(1.5, 2.25, THREE_BUY_ROWS),
    quietBar(2.5, 3),
    { footprint: footprintOf([]) },
    quietBar(3, 3.25),
  ];

  const zones = footprintStackedZones(bars, 3);

  expect(zones).toEqual([{ startIndex: 0, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2.25 }]);
});

test('the count of a stack sets how many rows a run needs, and a longer run stays one zone', () => {
  const fourRows = [row(0, ['buy']), row(1, ['buy']), row(2, ['buy']), row(3, ['buy'])];

  expect(footprintStackedZones([zoneBar(1.5, 2.5, fourRows)], 4)).toEqual([
    { startIndex: 0, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2.5 },
  ]);
  expect(footprintStackedZones([zoneBar(1.5, 2.5, fourRows)], 5)).toEqual([]);
  // Five consecutive rows are one run, so they form one zone of the whole span rather than two overlapping ones.
  expect(footprintStackedZones([zoneBar(1.5, 2.75, [...fourRows, row(4, ['buy'])])], 4)).toEqual([
    { startIndex: 0, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2.75 },
  ]);
});

test('each bar of the series is placed by its own index, whatever it traded', () => {
  const bars = [
    quietBar(2, 2.25),
    zoneBar(1.5, 2.25, THREE_BUY_ROWS),
    quietBar(1.5, 1.6),
    zoneBar(1.5, 2.25, THREE_BUY_ROWS),
  ];

  const zones = footprintStackedZones(bars, 3);

  expect(zones).toEqual([
    { startIndex: 1, endIndex: 2, side: 'buy', downPrice: 1.5, upPrice: 2.25 },
    { startIndex: 3, endIndex: null, side: 'buy', downPrice: 1.5, upPrice: 2.25 },
  ]);
});

test('a count no run can stack to forms no zone, and a bar without a footprint forms none', () => {
  expect(footprintStackedZones([zoneBar(1.5, 2.25, THREE_BUY_ROWS)], 0)).toEqual([]);
  expect(footprintStackedZones([zoneBar(1.5, 2.25, THREE_BUY_ROWS)], Number.NaN)).toEqual([]);
  expect(footprintStackedZones([zoneBar(1.5, 2.25)], 3)).toEqual([]);
});
