import { expect, test } from '@playwright/test';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import {
  BACKGROUND_STYLE,
  BASIS_STYLE,
  BollingerIndicator,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BAND_COLOR,
  DEFAULT_BASIS_COLOR,
  LENGTH_INPUT,
  MULT_INPUT,
  UPPER_STYLE,
} from '../src/features/indicators/bollinger/bollingerIndicator';
import { bollingerPlugin } from '../src/features/indicators/bollinger/bollingerPlugin';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import { MILLISECONDS_PER_SECOND, barAt, barsFromCloses } from './helpers/indicatorBars';

const BOLLINGER_LENGTH = 3;
const BOLLINGER_MULT = 2;
const BOLLINGER_CLOSES = [1, 2, 3, 4, 5, 6];
const BOLLINGER_BARS = barsFromCloses(BOLLINGER_CLOSES);
const EMPTY_VALUES = [null, null, null];
const UPPER_PLOT_INDEX = 1;
const LOWER_PLOT_INDEX = 2;
/** The closes 1, 2 and 3 average 2, and their population variance is 2/3. */
const THIRD_BAR_BASIS = 2;
const THIRD_BAR_OFFSET = BOLLINGER_MULT * Math.sqrt(2 / 3);

type SettingOverrides = Readonly<Record<string, number | string | boolean>>;

function bollingerSettings(overrides: SettingOverrides = {}): SettingValues {
  return resolveSettingValues(bollingerPlugin, {
    [LENGTH_INPUT]: BOLLINGER_LENGTH,
    [MULT_INPUT]: BOLLINGER_MULT,
    ...overrides,
  });
}

/** A basis and its two bands written straight from the definition, as the oracle to check against. */
function oracleBand(windowCloses: readonly number[]): readonly number[] {
  const basis = windowCloses.reduce((sum, close) => sum + close, 0) / windowCloses.length;
  const squaredDeviations = windowCloses.reduce((sum, close) => sum + (close - basis) ** 2, 0);
  const offset = BOLLINGER_MULT * Math.sqrt(squaredDeviations / windowCloses.length);
  return [basis, basis + offset, basis - offset];
}

function expectValuesCloseTo(values: readonly (number | null)[], expected: readonly number[]): void {
  expected.forEach((expectedValue, plotIndex) => {
    expect(values[plotIndex]).toBeCloseTo(expectedValue);
  });
}

test('the bands stay empty until length closes are held, then spread from the basis', () => {
  const frame = new BollingerIndicator().load(BOLLINGER_BARS, bollingerSettings());

  expect(frame.bars.slice(0, BOLLINGER_LENGTH - 1).map((bar) => bar.values)).toEqual([EMPTY_VALUES, EMPTY_VALUES]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, true, true, true, true, false]);

  const thirdBarValues = frame.bars[BOLLINGER_LENGTH - 1]?.values ?? [];
  expect(thirdBarValues[0]).toBeCloseTo(THIRD_BAR_BASIS);
  expect(thirdBarValues[1]).toBeCloseTo(THIRD_BAR_BASIS + THIRD_BAR_OFFSET);
  expect(thirdBarValues[2]).toBeCloseTo(THIRD_BAR_BASIS - THIRD_BAR_OFFSET);
});

test('a later bar measures its own window of closes', () => {
  const frame = new BollingerIndicator().load(BOLLINGER_BARS, bollingerSettings());
  const laterBars = [
    { barIndex: 3, windowCloses: [2, 3, 4] },
    { barIndex: 4, windowCloses: [3, 4, 5] },
    { barIndex: 5, windowCloses: [4, 5, 6] },
  ];

  for (const { barIndex, windowCloses } of laterBars) {
    expectValuesCloseTo(frame.bars[barIndex]?.values ?? [], oracleBand(windowCloses));
  }
});

test('the band between Upper and Lower is filled in the background colour', () => {
  const frame = new BollingerIndicator().load(BOLLINGER_BARS, bollingerSettings());

  expect(frame.fills).toEqual([
    {
      from: { kind: 'plot', index: UPPER_PLOT_INDEX },
      to: { kind: 'plot', index: LOWER_PLOT_INDEX },
      color: DEFAULT_BACKGROUND_COLOR,
    },
  ]);
});

test('switching the background off draws no fill', () => {
  const settings = bollingerSettings({ [settingStyleKey(BACKGROUND_STYLE, 'visible')]: false });

  expect(new BollingerIndicator().load(BOLLINGER_BARS, settings).fills).toEqual([]);
});

test('the plots are titled Basis, Upper and Lower in the default colours', () => {
  const plots = new BollingerIndicator().load(BOLLINGER_BARS, bollingerSettings()).plots;

  expect(plots.map((plot) => [plot.title, plot.color])).toEqual([
    ['Basis', DEFAULT_BASIS_COLOR],
    ['Upper', DEFAULT_BAND_COLOR],
    ['Lower', DEFAULT_BAND_COLOR],
  ]);
});

test('the style settings drive the dash pattern and the visibility of a plot', () => {
  const settings = bollingerSettings({
    [settingStyleKey(UPPER_STYLE, 'style')]: 'dashed',
    [settingStyleKey(BASIS_STYLE, 'visible')]: false,
  });
  const [basis, upper] = new BollingerIndicator().load(BOLLINGER_BARS, settings).plots;

  expect(upper).toMatchObject({ lineStyle: 'dashed', visible: true });
  expect(basis).toMatchObject({ lineStyle: 'solid', visible: false });
});

test('a tick replaces the forming bar only', () => {
  const settings = bollingerSettings();
  const indicator = new BollingerIndicator();
  indicator.load(BOLLINGER_BARS, settings);
  const tick = barAt(5, 9);

  const frame = indicator.update(tick, settings);

  expect(frame.bars).toHaveLength(1);
  expect(frame.bars[0]?.confirmed).toBe(false);
  expect(frame.bars[0]?.timeMs).toBe(tick.time * MILLISECONDS_PER_SECOND);
  expectValuesCloseTo(frame.bars[0]?.values ?? [], oracleBand([4, 5, 9]));
});

test('a newer bar returns the closed bar and then the forming one', () => {
  const settings = bollingerSettings();
  const indicator = new BollingerIndicator();
  const closedBar = barAt(4, 5);
  const nextBar = barAt(5, 6);
  indicator.load([...BOLLINGER_BARS.slice(0, 4), closedBar], settings);

  const frame = indicator.update(nextBar, settings);

  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, false]);
  expect(frame.bars.map((bar) => bar.timeMs)).toEqual(
    [closedBar, nextBar].map((bar) => bar.time * MILLISECONDS_PER_SECOND),
  );
});

test('live updates end where a fresh load of the same bars ends', () => {
  const settings = bollingerSettings();
  const live = new BollingerIndicator();
  live.load(BOLLINGER_BARS.slice(0, 4), settings);
  live.update(barAt(3, 7), settings);
  const closedFrame = live.update(barAt(4, 6), settings);
  const tickFrame = live.update(barAt(4, 8), settings);

  const fresh = new BollingerIndicator();
  const freshBars = fresh.load([...BOLLINGER_BARS.slice(0, 3), barAt(3, 7), barAt(4, 8)], settings).bars;
  const freshClosedValues = freshBars[3]?.values;
  const freshFormingValues = freshBars[freshBars.length - 1]?.values;

  expect(tickFrame.bars.map((bar) => bar.values)).toEqual([freshFormingValues]);
  expect(closedFrame.bars[0]).toMatchObject({ confirmed: true, values: freshClosedValues });
});

test('the registry and the legend name the Bollinger Bands', () => {
  expect(findChartIndicatorPlugin('bb')).toBe(bollingerPlugin);
  expect(indicatorLegendTitle('bb', resolveSettingValues(bollingerPlugin, {}))).toBe('BB 20 close 2');
});
