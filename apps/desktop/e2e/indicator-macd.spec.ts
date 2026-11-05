import { expect, test } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import type { IndicatorBar } from '../src/features/chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import {
  DEFAULT_FAST_LENGTH,
  DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR,
  DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR,
  DEFAULT_HISTOGRAM_BELOW_FALL_COLOR,
  DEFAULT_HISTOGRAM_BELOW_GROW_COLOR,
  DEFAULT_MACD_COLOR,
  DEFAULT_SIGNAL_COLOR,
  DEFAULT_SIGNAL_LENGTH,
  DEFAULT_SLOW_LENGTH,
  DEFAULT_ZERO_LINE_COLOR,
  FAST_LENGTH_INPUT,
  HISTOGRAM_STYLE,
  MacdIndicator,
  SIGNAL_LENGTH_INPUT,
  SLOW_LENGTH_INPUT,
} from '../src/features/indicators/macd/macdIndicator';
import { macdPlugin } from '../src/features/indicators/macd/macdPlugin';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import {
  MILLISECONDS_PER_SECOND,
  barAt,
  barsFromCloses,
  expectNewerBarClosesTheFormingOne,
} from './helpers/indicatorBars';

type SettingOverrides = Readonly<Record<string, number | string | boolean>>;

/** What the MACD of a series is, as the oracle of the definition reads it. */
interface OracleMacd {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

const HISTOGRAM_PLOT = 0;
const MACD_PLOT = 1;
const SIGNAL_PLOT = 2;
const SHORT_FAST_LENGTH = 2;
const SHORT_SLOW_LENGTH = 3;
const SHORT_SIGNAL_LENGTH = 2;
/** The slow line seeds one bar before its length and the signal after its count of MACD values. */
const FIRST_MACD_BAR = SHORT_SLOW_LENGTH - 1;
const FIRST_HISTOGRAM_BAR = FIRST_MACD_BAR + SHORT_SIGNAL_LENGTH - 1;
/** Closes whose steady rise makes the hand check a flat MACD, signal and histogram. */
const SHORT_CLOSES = [1, 2, 3, 4, 5, 6];
/** A rise that slows, turns and falls faster, so a column of every colour appears in turn. */
const COLOR_CLOSES = [10, 11, 12, 14, 17, 20, 22, 22, 21, 20, 19, 18, 16, 13, 9];
/** A fixed sixty close series of rises and falls, so the defaults run over more bars than they seed. */
const LONG_CLOSES = [
  100, 101, 102, 101, 100, 101, 103, 105, 104, 103, 102, 103, 105, 107, 108, 107, 106, 105, 106, 108, 110, 111, 109,
  107, 106, 105, 104, 105, 107, 109, 111, 113, 112, 110, 108, 107, 108, 110, 112, 114, 113, 111, 109, 108, 110, 112,
  115, 117, 116, 114, 112, 111, 112, 114, 116, 118, 117, 115, 113, 112,
];
const ORACLE_TOLERANCE = 1e-9;

function macdSettings(overrides: SettingOverrides = {}): SettingValues {
  return resolveSettingValues(macdPlugin, overrides);
}

/** The settings a short series reads with: both lines seed inside it, then the signal seeds after them. */
function shortSettings(overrides: SettingOverrides = {}): SettingValues {
  return macdSettings({
    [FAST_LENGTH_INPUT]: SHORT_FAST_LENGTH,
    [SLOW_LENGTH_INPUT]: SHORT_SLOW_LENGTH,
    [SIGNAL_LENGTH_INPUT]: SHORT_SIGNAL_LENGTH,
    ...overrides,
  });
}

/** One plot over the whole frame, with `null` on the bars that plot nothing. */
function barValues(bars: readonly IndicatorBar[], plotIndex: number): (number | null)[] {
  return bars.map((bar) => bar.values[plotIndex] ?? null);
}

/** One plot's colour on every bar, with `null` where the bar colours nothing. */
function barColors(bars: readonly IndicatorBar[], plotIndex: number): (string | null)[] {
  return bars.map((bar) => bar.colors?.[plotIndex] ?? null);
}

/** The bars a fresh load of `bars` draws, which a run of live updates has to end on. */
function loadedBars(bars: readonly RenderBar[], settings: SettingValues): readonly IndicatorBar[] {
  return new MacdIndicator().load(bars, settings).bars;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pine's `ta.ema` as an oracle: nothing until `length` values exist, their mean, then the step. */
function oracleEma(values: readonly (number | null)[], length: number): (number | null)[] {
  const weight = 2 / (length + 1);
  const seed: number[] = [];
  const emas: (number | null)[] = [];
  let average: number | null = null;
  for (const value of values) {
    if (value === null) {
      emas.push(null);
      continue;
    }
    if (average === null) {
      seed.push(value);
      if (seed.length < length) {
        emas.push(null);
        continue;
      }
      average = meanOf(seed);
      emas.push(average);
      continue;
    }
    average = weight * value + (1 - weight) * average;
    emas.push(average);
  }
  return emas;
}

/** The difference of two values, or nothing while either of them is still missing. */
function difference(minuend: number | null, subtrahend: number | null): number | null {
  if (minuend === null || subtrahend === null) {
    return null;
  }
  return minuend - subtrahend;
}

/** The MACD from the definition: the lines' difference, the signal of it and the histogram between. */
function oracleMacd(
  closes: readonly number[],
  fastLength: number,
  slowLength: number,
  signalLength: number,
): OracleMacd {
  const fast = oracleEma(closes, fastLength);
  const slow = oracleEma(closes, slowLength);
  const macd = closes.map((_, index) => difference(fast[index] ?? null, slow[index] ?? null));
  const signal = oracleEma(macd, signalLength);
  const histogram = macd.map((value, index) => difference(value, signal[index] ?? null));
  return { macd, signal, histogram };
}

/** Asserts a plot reads like the oracle's: the same bars without a value, and every gap below tolerance. */
function expectMatchesOracle(actual: readonly (number | null)[], expected: readonly (number | null)[]): void {
  expect(actual.map((value) => value === null)).toEqual(expected.map((value) => value === null));
  const gaps = actual.map((value, index) => Math.abs((value ?? 0) - (expected[index] ?? 0)));
  expect(Math.max(...gaps)).toBeLessThan(ORACLE_TOLERANCE);
}

test('the closes 1 to 6 read a flat MACD of 0.5 and a signal of 0.5', () => {
  const frame = new MacdIndicator().load(barsFromCloses(SHORT_CLOSES), shortSettings());
  const macd = barValues(frame.bars, MACD_PLOT);
  const signal = barValues(frame.bars, SIGNAL_PLOT);
  const histogram = barValues(frame.bars, HISTOGRAM_PLOT);

  expect(macd.slice(0, FIRST_MACD_BAR)).toEqual([null, null]);
  expect(signal.slice(0, FIRST_HISTOGRAM_BAR)).toEqual([null, null, null]);
  expect(histogram.slice(0, FIRST_HISTOGRAM_BAR)).toEqual([null, null, null]);
  macd.slice(FIRST_MACD_BAR).forEach((value) => {
    expect(value ?? Number.NaN).toBeCloseTo(0.5);
  });
  signal.slice(FIRST_HISTOGRAM_BAR).forEach((value) => {
    expect(value ?? Number.NaN).toBeCloseTo(0.5);
  });
  histogram.slice(FIRST_HISTOGRAM_BAR).forEach((value) => {
    expect(value ?? Number.NaN).toBeCloseTo(0);
  });
});

test('every bar of a long series matches an oracle written from the definition', () => {
  const frame = new MacdIndicator().load(barsFromCloses(LONG_CLOSES), macdSettings());
  const oracle = oracleMacd(LONG_CLOSES, DEFAULT_FAST_LENGTH, DEFAULT_SLOW_LENGTH, DEFAULT_SIGNAL_LENGTH);

  expectMatchesOracle(barValues(frame.bars, MACD_PLOT), oracle.macd);
  expectMatchesOracle(barValues(frame.bars, SIGNAL_PLOT), oracle.signal);
  expectMatchesOracle(barValues(frame.bars, HISTOGRAM_PLOT), oracle.histogram);
});

test('the columns take the four colours as the histogram grows and falls on either side of zero', () => {
  const frame = new MacdIndicator().load(barsFromCloses(COLOR_CLOSES), shortSettings());
  const colors = barColors(frame.bars, HISTOGRAM_PLOT);
  const columnColor = (column: number): string | null | undefined => colors[FIRST_HISTOGRAM_BAR + column];

  expect(colors.slice(0, FIRST_HISTOGRAM_BAR)).toEqual([null, null, null]);
  expect(columnColor(0)).toBe(DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR); // no column before it, so no growth
  expect(columnColor(1)).toBe(DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR); // growing above zero
  expect(columnColor(2)).toBe(DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR); // shrinking above zero
  expect(columnColor(6)).toBe(DEFAULT_HISTOGRAM_BELOW_GROW_COLOR); // growing below zero
  expect(columnColor(9)).toBe(DEFAULT_HISTOGRAM_BELOW_FALL_COLOR); // shrinking below zero
});

test('the frame draws the columns first, the two lines and the dashed zero line', () => {
  const frame = new MacdIndicator().load(barsFromCloses(SHORT_CLOSES), shortSettings());

  expect(frame.plots.map((plot) => [plot.title, plot.style, plot.color])).toEqual([
    ['Histogram', 'histogram', DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR],
    ['MACD', 'line', DEFAULT_MACD_COLOR],
    ['Signal', 'line', DEFAULT_SIGNAL_COLOR],
  ]);
  expect(frame.levels?.map((level) => [level.title, level.price, level.color, level.lineStyle])).toEqual([
    ['Zero Line', 0, DEFAULT_ZERO_LINE_COLOR, 'dashed'],
  ]);
  expect(frame.precision).toBeUndefined();
});

test('switching the histogram off hides the histogram plot', () => {
  const settings = shortSettings({ [settingStyleKey(HISTOGRAM_STYLE, 'visible')]: false });
  const frame = new MacdIndicator().load(barsFromCloses(SHORT_CLOSES), settings);

  expect(frame.plots[HISTOGRAM_PLOT]).toMatchObject({ visible: false });
});

test('a tick redraws only the forming bar and leaves the state alone', () => {
  const settings = shortSettings();
  const indicator = new MacdIndicator();
  indicator.load(barsFromCloses(SHORT_CLOSES), settings);
  const tickedBar = barAt(SHORT_CLOSES.length - 1, 2);

  const firstFrame = indicator.update(tickedBar, settings);
  const repeatedFrame = indicator.update(tickedBar, settings);
  const freshBars = loadedBars([...barsFromCloses(SHORT_CLOSES.slice(0, -1)), tickedBar], settings);

  expect(firstFrame.bars.map((bar) => bar.confirmed)).toEqual([false]);
  expect(firstFrame.bars[0]?.timeMs).toBe(tickedBar.time * MILLISECONDS_PER_SECOND);
  expect(firstFrame.bars[0]).toEqual(freshBars[freshBars.length - 1]);
  expect(repeatedFrame.bars).toEqual(firstFrame.bars);
});

test('a newer bar returns the closed bar and then the forming one', () => {
  expectNewerBarClosesTheFormingOne(
    new MacdIndicator(),
    [...barsFromCloses(SHORT_CLOSES.slice(0, 3)), barAt(3, 4)],
    shortSettings(),
  );
});

test('live updates end where a fresh load of the same bars ends', () => {
  const settings = shortSettings();
  const live = new MacdIndicator();
  live.load(barsFromCloses(SHORT_CLOSES.slice(0, 4)), settings);
  live.update(barAt(3, 8), settings);
  const closingFrame = live.update(barAt(4, 7), settings);
  const tickedFrame = live.update(barAt(4, 9), settings);
  const freshBars = loadedBars([...barsFromCloses(SHORT_CLOSES.slice(0, 3)), barAt(3, 8), barAt(4, 9)], settings);

  expect(closingFrame.bars[0]).toEqual(freshBars[freshBars.length - 2]);
  expect(tickedFrame.bars).toEqual([freshBars[freshBars.length - 1]]);
});

test('the registry names the MACD and draws it in a pane of its own', () => {
  expect(findChartIndicatorPlugin('macd')).toBe(macdPlugin);
  expect(findChartIndicatorPlugin('macd')?.pane).toBe('own');
  expect(indicatorLegendTitle('macd', resolveSettingValues(macdPlugin, {}))).toBe('MACD 12 26 close 9');
});
