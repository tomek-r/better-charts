import { expect, test } from '@playwright/test';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { LENGTH_INPUT } from '../src/features/indicators/indicatorInputs';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import {
  BACKGROUND_STYLE,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BAND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_MIDDLE_BAND_COLOR,
  LOWER_BAND,
  MIDDLE_BAND,
  PLOT_STYLE,
  RsiIndicator,
  UPPER_BAND,
  UPPER_BAND_STYLE,
} from '../src/features/indicators/rsi/rsiIndicator';
import { rsiPlugin } from '../src/features/indicators/rsi/rsiPlugin';
import {
  MILLISECONDS_PER_SECOND,
  barAt,
  barsFromCloses,
  expectNewerBarClosesTheFormingOne,
} from './helpers/indicatorBars';

type SettingOverrides = Readonly<Record<string, number | string | boolean>>;

const HAND_CHECK_LENGTH = 2;
/** Closes whose two changes both rise, then both fall, so the hand check is 100, 50 and 25. */
const HAND_CHECK_CLOSES = [1, 2, 3, 2, 1];
const LONG_LENGTH = 14;
/** Wilder's example series, a fixed list of rises, falls and one flat bar. */
const LONG_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46, 46.03,
  46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 46.68, 46.32, 46.8, 47.1, 46.9, 47.35,
];
const RUN_LENGTH = 2;
const RISING_CLOSES = [1, 2, 3, 4, 5];
const FALLING_CLOSES = [5, 4, 3, 2, 1];
const LIVE_LENGTH = 3;
const LIVE_CLOSES = [1, 2, 3, 4, 5, 6];
const UPPER_LEVEL_INDEX = 0;
const LOWER_LEVEL_INDEX = 2;

function rsiSettings(length: number, overrides: SettingOverrides = {}): SettingValues {
  return resolveSettingValues(rsiPlugin, { [LENGTH_INPUT]: length, ...overrides });
}

/** One change per bar after the first, written from the definition rather than from the indicator. */
function changesBetweenCloses(closes: readonly number[]): readonly number[] {
  const changes: number[] = [];
  let previousClose: number | null = null;
  for (const close of closes) {
    if (previousClose !== null) {
      changes.push(close - previousClose);
    }
    previousClose = close;
  }
  return changes;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pine's `ta.rma` as an oracle: nothing until `length` values exist, then their mean, then the mean step. */
function oracleRma(values: readonly number[], length: number): readonly (number | null)[] {
  const averages: (number | null)[] = [];
  values.forEach((value, index) => {
    const previousAverage = averages[index - 1] ?? null;
    if (index < length - 1) {
      averages.push(null);
      return;
    }
    if (previousAverage === null) {
      averages.push(meanOf(values.slice(0, length)));
      return;
    }
    averages.push((previousAverage * (length - 1) + value) / length);
  });
  return averages;
}

/** Pine's `ta.rsi` of the two averages, where no fall reads 100 and no rise reads 0. */
function oracleValue(gainAverage: number | null, lossAverage: number | null): number | null {
  if (gainAverage === null || lossAverage === null) {
    return null;
  }
  if (lossAverage === 0) {
    return 100;
  }
  if (gainAverage === 0) {
    return 0;
  }
  return 100 - 100 / (1 + gainAverage / lossAverage);
}

function oracleRsi(closes: readonly number[], length: number): readonly (number | null)[] {
  const changes = changesBetweenCloses(closes);
  const gains = oracleRma(
    changes.map((change) => Math.max(change, 0)),
    length,
  );
  const losses = oracleRma(
    changes.map((change) => Math.max(-change, 0)),
    length,
  );
  return [null, ...gains.map((gain, index) => oracleValue(gain, losses[index] ?? null))];
}

/** The newest RSI the oracle gives for the closes. */
function oracleNewest(closes: readonly number[], length: number): number | null {
  const values = oracleRsi(closes, length);
  return values[values.length - 1] ?? null;
}

function expectValuesCloseTo(actual: readonly (number | null)[], expected: readonly (number | null)[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((expectedValue, index) => {
    if (expectedValue === null) {
      expect(actual[index] ?? null).toBeNull();
      return;
    }
    expect(actual[index] ?? null).toBeCloseTo(expectedValue);
  });
}

test('the closes 1, 2, 3, 2, 1 read 100, 50 and 25 with a length of two', () => {
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), rsiSettings(HAND_CHECK_LENGTH));
  const values = frame.bars.map((bar) => bar.values[0] ?? null);

  expect(values.slice(0, HAND_CHECK_LENGTH)).toEqual([null, null]);
  expect(values[2]).toBeCloseTo(100);
  expect(values[3]).toBeCloseTo(50);
  expect(values[4]).toBeCloseTo(25);
});

test('the RSI waits for the first length changes', () => {
  const frame = new RsiIndicator().load(barsFromCloses(LONG_CLOSES), rsiSettings(LONG_LENGTH));
  const beforeSeed = frame.bars.slice(0, LONG_LENGTH).map((bar) => bar.values[0] ?? null);

  expect(beforeSeed.every((value) => value === null)).toBe(true);
  expect(frame.bars[LONG_LENGTH - 1]?.values[0] ?? null).toBeNull();
  expect(frame.bars[LONG_LENGTH]?.values[0] ?? null).not.toBeNull();
});

test('every bar of a longer series matches an oracle written from the definition', () => {
  const frame = new RsiIndicator().load(barsFromCloses(LONG_CLOSES), rsiSettings(LONG_LENGTH));
  const values = frame.bars.map((bar) => bar.values[0] ?? null);

  expectValuesCloseTo(values, oracleRsi(LONG_CLOSES, LONG_LENGTH));
});

test('rises without a fall read 100 and falls without a rise read 0', () => {
  const rising = new RsiIndicator().load(barsFromCloses(RISING_CLOSES), rsiSettings(RUN_LENGTH));
  const falling = new RsiIndicator().load(barsFromCloses(FALLING_CLOSES), rsiSettings(RUN_LENGTH));

  expect(rising.bars.map((bar) => bar.values[0] ?? null)).toEqual([null, null, 100, 100, 100]);
  expect(falling.bars.map((bar) => bar.values[0] ?? null)).toEqual([null, null, 0, 0, 0]);
});

test('the frame draws one RSI line, the three bands and the fill between the outer two', () => {
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), rsiSettings(HAND_CHECK_LENGTH));

  expect(frame.plots.map((plot) => [plot.title, plot.color])).toEqual([['RSI', DEFAULT_COLOR]]);
  expect(frame.levels?.map((level) => [level.title, level.price, level.color, level.lineStyle])).toEqual([
    ['Upper Band', UPPER_BAND, DEFAULT_BAND_COLOR, 'dashed'],
    ['Middle Band', MIDDLE_BAND, DEFAULT_MIDDLE_BAND_COLOR, 'dotted'],
    ['Lower Band', LOWER_BAND, DEFAULT_BAND_COLOR, 'dashed'],
  ]);
  const [bandFill] = frame.fills ?? [];
  expect(bandFill?.from).toEqual({ kind: 'level', index: UPPER_LEVEL_INDEX });
  expect(bandFill?.to).toEqual({ kind: 'level', index: LOWER_LEVEL_INDEX });
  expect(bandFill?.color).toBe(DEFAULT_BACKGROUND_COLOR);
  expect(frame.precision).toBe(2);
});

test('switching the background off draws no fill', () => {
  const settings = rsiSettings(HAND_CHECK_LENGTH, { [settingStyleKey(BACKGROUND_STYLE, 'visible')]: false });

  expect(new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), settings).fills).toEqual([]);
});

test('the style settings drive the plot colour and a band dash', () => {
  const settings = rsiSettings(HAND_CHECK_LENGTH, {
    [settingStyleKey(PLOT_STYLE, 'color')]: '#FF0000',
    [settingStyleKey(UPPER_BAND_STYLE, 'style')]: 'solid',
  });
  const frame = new RsiIndicator().load(barsFromCloses(HAND_CHECK_CLOSES), settings);

  expect(frame.plots[0]?.color).toBe('#FF0000');
  expect(frame.levels?.[UPPER_LEVEL_INDEX]).toMatchObject({ lineStyle: 'solid', visible: true });
});

test('a tick redraws only the forming bar and leaves the state alone', () => {
  const settings = rsiSettings(LIVE_LENGTH);
  const indicator = new RsiIndicator();
  indicator.load(barsFromCloses(LIVE_CLOSES), settings);
  const tickedBar = barAt(LIVE_CLOSES.length - 1, 2);

  const firstFrame = indicator.update(tickedBar, settings);
  const repeatedFrame = indicator.update(tickedBar, settings);

  expect(firstFrame.bars.map((bar) => bar.confirmed)).toEqual([false]);
  expect(firstFrame.bars[0]?.timeMs).toBe(tickedBar.time * MILLISECONDS_PER_SECOND);
  expectValuesCloseTo(
    firstFrame.bars.map((bar) => bar.values[0] ?? null),
    [oracleNewest([...LIVE_CLOSES.slice(0, -1), 2], LIVE_LENGTH)],
  );
  expect(repeatedFrame.bars).toEqual(firstFrame.bars);
});

test('a newer bar returns the closed bar and then the forming one', () => {
  expectNewerBarClosesTheFormingOne(
    new RsiIndicator(),
    [...barsFromCloses(LIVE_CLOSES.slice(0, 3)), barAt(3, 4)],
    rsiSettings(LIVE_LENGTH),
  );
});

test('live updates end where a fresh load of the same bars ends', () => {
  const settings = rsiSettings(LIVE_LENGTH);
  const live = new RsiIndicator();
  live.load(barsFromCloses(LIVE_CLOSES.slice(0, 4)), settings);
  live.update(barAt(3, 8), settings);
  const closingFrame = live.update(barAt(4, 6), settings);
  const tickingFrame = live.update(barAt(4, 10), settings);

  const freshBars = new RsiIndicator().load(
    [...barsFromCloses(LIVE_CLOSES.slice(0, 3)), barAt(3, 8), barAt(4, 10)],
    settings,
  ).bars;
  const freshClosedValues = freshBars[freshBars.length - 2]?.values;
  const freshFormingValues = freshBars[freshBars.length - 1]?.values;

  expect(tickingFrame.bars.map((bar) => bar.values)).toEqual([freshFormingValues]);
  expect(closingFrame.bars[0]).toMatchObject({ confirmed: true, values: freshClosedValues });
});

test('the registry names the RSI and draws it in a pane of its own', () => {
  expect(findChartIndicatorPlugin('rsi')).toBe(rsiPlugin);
  expect(findChartIndicatorPlugin('rsi')?.pane).toBe('own');
  expect(indicatorLegendTitle('rsi', resolveSettingValues(rsiPlugin, {}))).toBe('RSI 14 close');
});
