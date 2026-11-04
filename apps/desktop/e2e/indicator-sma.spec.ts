import { expect, test } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { sourceValue } from '../src/features/chart/engine/indicators/indicatorSource';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import { PLOT_STYLE, SmaIndicator } from '../src/features/indicators/sma/smaIndicator';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';

const FIRST_BAR_TIME = 1_700_000_000;
const BAR_SPACING_SECONDS = 300;
const MILLISECONDS_PER_SECOND = 1000;
const SMA_LENGTH = 3;
const SOURCE_LENGTH = 2;
const LEADING_NULLS = [null, null];

function barAt(index: number, close: number, high = close, low = close): RenderBar {
  return {
    time: FIRST_BAR_TIME + index * BAR_SPACING_SECONDS,
    open: close,
    high,
    low,
    close,
    volume: 0,
  };
}

const SIX_BARS = [1, 2, 3, 4, 5, 6].map((close, index) => barAt(index, close));

type SettingOverrides = Readonly<Record<string, number | string>>;

function loadedSmaValues(bars: readonly RenderBar[], overrides: SettingOverrides): (number | null)[] {
  const settings = resolveSettingValues(smaPlugin, overrides);
  return new SmaIndicator().load(bars, settings).bars.map((bar) => bar.values[0] ?? null);
}

function updatedSmaValues(indicator: SmaIndicator, liveBar: RenderBar, settings: SettingValues): (number | null)[] {
  return indicator.update(liveBar, settings).bars.map((bar) => bar.values[0] ?? null);
}

test('the SMA averages the last length closes and has no value before them', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const frame = new SmaIndicator().load(SIX_BARS, settings);

  expect(frame.bars.map((bar) => bar.values[0])).toEqual([...LEADING_NULLS, 2, 3, 4, 5]);
  expect(frame.bars.map((bar) => bar.timeMs)).toEqual(SIX_BARS.map((bar) => bar.time * MILLISECONDS_PER_SECOND));
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, true, true, true, true, false]);
});

test('the source input picks the price the SMA averages', () => {
  const bars = [barAt(0, 10, 12, 8), barAt(1, 20, 22, 18)];

  expect(loadedSmaValues(bars, { length: SOURCE_LENGTH, source: 'hl2' })).toEqual([null, 15]);
  expect(loadedSmaValues(bars, { length: SOURCE_LENGTH, source: 'hlcc4' })).toEqual([null, 15]);
  expect(loadedSmaValues(bars, { length: SOURCE_LENGTH, source: 'high' })).toEqual([null, 17]);
});

test('a newer bar closes the forming bar and starts a new one', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const indicator = new SmaIndicator();
  indicator.load(SIX_BARS.slice(0, 5), settings);
  const liveTimes = SIX_BARS.slice(4).map((bar) => bar.time * MILLISECONDS_PER_SECOND);

  const frame = indicator.update(barAt(5, 6), settings);

  expect(frame.bars.map((bar) => bar.values[0])).toEqual([4, 5]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, false]);
  expect(frame.bars.map((bar) => bar.timeMs)).toEqual(liveTimes);
});

test('a tick replaces the forming bar only', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const indicator = new SmaIndicator();
  indicator.load(SIX_BARS, settings);
  const tick = barAt(5, 9);

  const frame = indicator.update(tick, settings);

  expect(frame.bars.map((bar) => bar.values[0])).toEqual([6]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([false]);
  expect(frame.bars.map((bar) => bar.timeMs)).toEqual([tick.time * MILLISECONDS_PER_SECOND]);
});

test('a tick after a new bar averages from the closed bars only', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const indicator = new SmaIndicator();
  indicator.load(SIX_BARS, settings);

  expect(updatedSmaValues(indicator, barAt(6, 7), settings)).toEqual([5, 6]);

  const frame = indicator.update(barAt(6, 10), settings);
  expect(frame.bars.map((bar) => bar.values[0])).toEqual([7]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([false]);
});

test('a bar older than the forming one changes nothing', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const indicator = new SmaIndicator();
  indicator.load(SIX_BARS, settings);

  expect(indicator.update(barAt(2, 99), settings).bars).toEqual([]);
});

test('the first live bar after an empty history starts the forming bar', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const indicator = new SmaIndicator();
  indicator.load([], settings);

  expect(updatedSmaValues(indicator, barAt(0, 10), settings)).toEqual([null]);
});

test('live updates end where a fresh load of the same bars ends', () => {
  const settings = resolveSettingValues(smaPlugin, { length: SMA_LENGTH });
  const live = new SmaIndicator();
  live.load(SIX_BARS.slice(0, 4), settings);
  updatedSmaValues(live, barAt(3, 7), settings);
  const closedFrame = live.update(barAt(4, 6), settings);
  const tickValues = updatedSmaValues(live, barAt(4, 8), settings);

  const freshValues = new SmaIndicator()
    .load([...SIX_BARS.slice(0, 3), barAt(3, 7), barAt(4, 8)], settings)
    .bars.map((bar) => bar.values[0]);
  const freshBarThree = freshValues[3] ?? null;
  const freshForming = freshValues[freshValues.length - 1] ?? null;

  expect(tickValues).toEqual([freshForming]);
  expect(closedFrame.bars[0]).toMatchObject({ confirmed: true, values: [freshBarThree] });
});

test('the plot is drawn in the style settings', () => {
  const bars = [barAt(0, 10)];
  const indicator = new SmaIndicator();

  const defaults = indicator.load(bars, resolveSettingValues(smaPlugin, {}));
  expect(defaults.plots).toEqual([{ title: 'SMA', style: 'line', color: '#2962FF', lineWidth: 1 }]);

  const styled = indicator.load(
    bars,
    resolveSettingValues(smaPlugin, {
      [settingStyleKey(PLOT_STYLE, 'color')]: '#ff0000',
      [settingStyleKey(PLOT_STYLE, 'width')]: 3,
    }),
  );
  expect(styled.plots).toEqual([{ title: 'SMA', style: 'line', color: '#ff0000', lineWidth: 3 }]);
});

test('the registry finds the SMA by id and nothing for an unknown one', () => {
  expect(findChartIndicatorPlugin('sma')?.shortTitle).toBe('SMA');
  expect(findChartIndicatorPlugin('nope')).toBeUndefined();
});

test('sourceValue reads hlcc4 as high, low and the close twice', () => {
  expect(sourceValue(barAt(0, 5, 8, 2), 'hlcc4')).toBe(5);
});
