import { expect, test } from '@playwright/test';

import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { settingStyleKey } from '../src/features/chart/engine/settings/settingStyles';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { PLOT_TYPES, plotDrawingOf } from '../src/features/indicators/plotTypes';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import { EMA_TYPE, SMA_TYPE } from '../src/features/indicators/volume/volumeAverage';
import {
  FALLING_STYLE,
  GROWING_STYLE,
  MA_LENGTH_INPUT,
  MA_STYLE,
  MA_TYPE_INPUT,
  PLOT_TYPE_STYLE,
  PRICE_LINE_STYLE,
  VOLUME_STYLE,
  VolumeIndicator,
} from '../src/features/indicators/volume/volumeIndicator';
import { volumePlugin } from '../src/features/indicators/volume/volumePlugin';
import { barAt, barsFromCloses, expectNewerBarClosesTheFormingOne } from './helpers/indicatorBars';

const DEFAULT_SETTINGS = resolveSettingValues(volumePlugin, {});
const DEFAULT_PLOT = {
  title: 'Volume',
  style: 'histogram',
  gaps: 'break',
  color: '#08998180',
  lineWidth: 1,
  visible: true,
  priceLine: false,
};
const GROWING_COLUMN = ['#08998180'];
const FALLING_COLUMN = ['#F2364580'];

/** Every Plot type Volume offers, with the style and gap behaviour its stored value resolves to. */
const PLOT_TYPE_CASES = [
  { value: 'line', style: 'line', gaps: 'connect' },
  { value: 'lineBreaks', style: 'line', gaps: 'break' },
  { value: 'step', style: 'stepline', gaps: 'connect' },
  { value: 'stepBreaks', style: 'stepline', gaps: 'break' },
  { value: 'stepDiamonds', style: 'steplineDiamonds', gaps: 'connect' },
  { value: 'histogram', style: 'stems', gaps: 'break' },
  { value: 'cross', style: 'crosses', gaps: 'break' },
  { value: 'area', style: 'area', gaps: 'connect' },
  { value: 'areaBreaks', style: 'area', gaps: 'break' },
  { value: 'columns', style: 'histogram', gaps: 'break' },
  { value: 'circles', style: 'circles', gaps: 'break' },
] as const;

const MA_LENGTH = 3;
const MA_COLOR = '#2196F3';
/** The MA's value and plot follow the columns in each frame. */
const MA_SLOT = 1;

/** A bar with a real body and a volume, which `barAt` alone cannot express. */
function volumeBar(index: number, open: number, close: number, volume: number): RenderBar {
  return { ...barAt(index, close, Math.max(open, close), Math.min(open, close)), open, volume };
}

/** The Volume settings with its MA line switched on, of `type`, over `length` bars. */
function averageSettings(type: string, length: number) {
  return resolveSettingValues(volumePlugin, {
    [MA_TYPE_INPUT]: type,
    [MA_LENGTH_INPUT]: length,
    [settingStyleKey(MA_STYLE, 'visible')]: true,
  });
}

const SIMPLE_AVERAGE_SETTINGS = averageSettings(SMA_TYPE, MA_LENGTH);
const EXPONENTIAL_AVERAGE_SETTINGS = averageSettings(EMA_TYPE, MA_LENGTH);
const FOUR_BARS = [10, 20, 30, 70].map((volume, index) => volumeBar(index, 1, 2, volume));

const GROWING_BAR = volumeBar(0, 1, 2, 100);
const FALLING_BAR = volumeBar(1, 3, 2, 50);
const UNCHANGED_BAR = volumeBar(2, 2, 2, 0);

test('volume plots what each bar traded and colours the column by its open', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR, FALLING_BAR, UNCHANGED_BAR], DEFAULT_SETTINGS);

  expect(frame.bars.map((bar) => bar.values)).toEqual([[100], [50], [0]]);
  expect(frame.bars.map((bar) => bar.colors)).toEqual([GROWING_COLUMN, FALLING_COLUMN, GROWING_COLUMN]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, true, false]);
  expect(frame.precision).toBe(0);
});

test('the Volume histogram starts in the style defaults', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR], DEFAULT_SETTINGS);

  expect(frame.plots).toEqual([DEFAULT_PLOT]);
});

test('the Plot type list offers eleven ways to draw the volume plot, in the order it shows them', () => {
  const values = PLOT_TYPES.map((plotType) => plotType.value);

  expect(values).toEqual(PLOT_TYPE_CASES.map((plotType) => plotType.value));
});

test('a plot with its own style ids and a line default draws from settings alone, with no Volume key', () => {
  const drawing = plotDrawingOf({}, 'otherPlotType', 'otherPriceLine', 'line');

  expect(drawing).toEqual({ style: 'line', gaps: 'connect', priceLine: false });
});

for (const { value, style, gaps } of PLOT_TYPE_CASES) {
  test(`the ${value} Plot type draws a ${style} plot with ${gaps} gaps`, () => {
    const settings = resolveSettingValues(volumePlugin, { [PLOT_TYPE_STYLE]: value });
    const frame = new VolumeIndicator().load([GROWING_BAR], settings);

    expect(frame.plots[0]).toMatchObject({ title: 'Volume', style, gaps });
  });
}

test('the default Plot type is Columns, drawing columns that break at a missing value', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR], DEFAULT_SETTINGS);

  expect(frame.plots[0]).toMatchObject({ style: 'histogram', gaps: 'break' });
});

test('a stored Plot type the list does not know reads as the Columns default', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR], { [PLOT_TYPE_STYLE]: 'sausages' });

  expect(frame.plots).toEqual([DEFAULT_PLOT]);
});

test('the Price line switch reaches the plot', () => {
  const settings = resolveSettingValues(volumePlugin, { [settingStyleKey(PRICE_LINE_STYLE, 'visible')]: true });

  const frame = new VolumeIndicator().load([GROWING_BAR], settings);

  expect(frame.plots[0]).toMatchObject({ priceLine: true });
});

test('the stored growing and falling colours reach the columns', () => {
  const settings = resolveSettingValues(volumePlugin, {
    [settingStyleKey(GROWING_STYLE, 'color')]: '#00ff00',
    [settingStyleKey(FALLING_STYLE, 'color')]: '#ff0000',
  });

  const frame = new VolumeIndicator().load([GROWING_BAR, FALLING_BAR], settings);

  expect(frame.bars.map((bar) => bar.colors)).toEqual([['#00ff00'], ['#ff0000']]);
});

test('the Volume toggle hides the columns', () => {
  const settings = resolveSettingValues(volumePlugin, { [settingStyleKey(VOLUME_STYLE, 'visible')]: false });

  const frame = new VolumeIndicator().load([GROWING_BAR], settings);

  expect(frame.plots).toEqual([{ ...DEFAULT_PLOT, visible: false }]);
});

test('a tick of the forming bar redraws its own column from the new volume', () => {
  const indicator = new VolumeIndicator();
  indicator.load([GROWING_BAR], DEFAULT_SETTINGS);

  const frame = indicator.update(volumeBar(0, 3, 2, 70), DEFAULT_SETTINGS);

  expect(frame.bars.map((bar) => bar.values)).toEqual([[70]]);
  expect(frame.bars.map((bar) => bar.colors)).toEqual([FALLING_COLUMN]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([false]);
});

test('a newer bar returns the one it closed, confirmed, and then itself, still forming', () => {
  expectNewerBarClosesTheFormingOne(new VolumeIndicator(), barsFromCloses([1, 2]), DEFAULT_SETTINGS);
});

test('the MA is off by default, so the frame holds only the columns plot', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR], DEFAULT_SETTINGS);

  expect(frame.plots).toHaveLength(1);
  expect(frame.bars.map((bar) => bar.values)).toEqual([[100]]);
});

test('switched on, the MA is the second plot and writes no point colours of its own', () => {
  const frame = new VolumeIndicator().load([GROWING_BAR], SIMPLE_AVERAGE_SETTINGS);

  expect(frame.plots[MA_SLOT]).toMatchObject({ title: 'Volume MA', style: 'line', color: MA_COLOR });
  expect(frame.bars.map((bar) => bar.colors)).toEqual([['#08998180', null]]);
});

test('the MA plots the simple and the exponential average of the volumes', () => {
  const bars = [10, 20, 30, 70, 20].map((volume, index) => volumeBar(index, 1, 2, volume));

  const simple = new VolumeIndicator().load(bars, SIMPLE_AVERAGE_SETTINGS);
  const exponential = new VolumeIndicator().load(bars, EXPONENTIAL_AVERAGE_SETTINGS);

  expect(simple.bars.map((bar) => bar.values[MA_SLOT])).toEqual([null, null, 20, 40, 40]);
  expect(exponential.bars.map((bar) => bar.values[MA_SLOT])).toEqual([null, null, 20, 45, 32.5]);
});

test('the MA follows the forming bar and moves on the one that closes', () => {
  const simple = new VolumeIndicator();
  simple.load(FOUR_BARS, SIMPLE_AVERAGE_SETTINGS);
  const exponential = new VolumeIndicator();
  exponential.load(FOUR_BARS, EXPONENTIAL_AVERAGE_SETTINGS);

  const tick = simple.update(volumeBar(3, 1, 2, 10), SIMPLE_AVERAGE_SETTINGS);
  const exponentialTick = exponential.update(volumeBar(3, 1, 2, 10), EXPONENTIAL_AVERAGE_SETTINGS);

  expect(tick.bars.map((bar) => bar.values[MA_SLOT])).toEqual([20]);
  expect(exponentialTick.bars.map((bar) => bar.values[MA_SLOT])).toEqual([15]);
  expect(tick.bars.map((bar) => bar.confirmed)).toEqual([false]);

  simple.update(volumeBar(3, 1, 2, 70), SIMPLE_AVERAGE_SETTINGS);
  exponential.update(volumeBar(3, 1, 2, 70), EXPONENTIAL_AVERAGE_SETTINGS);
  const closed = simple.update(volumeBar(4, 1, 2, 20), SIMPLE_AVERAGE_SETTINGS);
  const exponentialClosed = exponential.update(volumeBar(4, 1, 2, 20), EXPONENTIAL_AVERAGE_SETTINGS);

  expect(closed.bars.map((bar) => bar.values[MA_SLOT])).toEqual([40, 40]);
  expect(exponentialClosed.bars.map((bar) => bar.values[MA_SLOT])).toEqual([45, 32.5]);
  expect(closed.bars.map((bar) => bar.confirmed)).toEqual([true, false]);
});

test('the plugin registers in a pane of its own and titles itself Vol SMA 20', () => {
  expect(findChartIndicatorPlugin('volume')).toBe(volumePlugin);
  expect(volumePlugin.pane).toBe('own');
  expect(indicatorLegendTitle('volume', DEFAULT_SETTINGS)).toBe('Vol SMA 20');
});

test('the legend title follows the chosen MA type', () => {
  const settings = resolveSettingValues(volumePlugin, { [MA_TYPE_INPUT]: EMA_TYPE });

  expect(indicatorLegendTitle('volume', settings)).toBe('Vol EMA 20');
});
