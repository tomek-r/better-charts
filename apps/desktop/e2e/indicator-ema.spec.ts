import { expect, test } from '@playwright/test';

import type { IndicatorFrame } from '../src/features/chart/engine/indicators/indicatorFrame';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { EmaIndicator, LENGTH_INPUT, SOURCE_INPUT } from '../src/features/indicators/ema/emaIndicator';
import { emaPlugin } from '../src/features/indicators/ema/emaPlugin';
import { indicatorLegendTitle } from '../src/features/indicators/indicatorLegendTitle';
import { findChartIndicatorPlugin } from '../src/features/indicators/registry';
import { barAt, barsFromCloses, expectNewerBarClosesTheFormingOne } from './helpers/indicatorBars';

const INDICATOR_ID = 'ema';
const LENGTH_THREE = resolveSettingValues(emaPlugin, { [LENGTH_INPUT]: 3 });
const DEFAULT_PLOT = {
  title: 'EMA',
  style: 'line',
  color: '#2962FF',
  lineWidth: 1,
  lineStyle: 'solid',
  visible: true,
};

/** The one value each bar plots, in bar order. */
function emaValues(frame: IndicatorFrame): readonly (number | null)[] {
  return frame.bars.map((bar) => bar.values[0]);
}

/** The closes whose forming fourth bar, 10, every tick test starts from. */
const CLOSES_THROUGH_TEN = barsFromCloses([2, 4, 6, 10]);

test('an EMA of three closes seeds on their simple average and smooths from there', () => {
  const frame = new EmaIndicator().load(barsFromCloses([2, 4, 6, 10, 2]), LENGTH_THREE);

  expect(emaValues(frame)).toEqual([null, null, 4, 7, 4.5]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, true, true, true, false]);
});

test('the source input names the price the EMA smooths', () => {
  const twoBars = [barAt(0, 10, 12, 8), barAt(1, 20, 22, 18)];
  const settings = resolveSettingValues(emaPlugin, { [LENGTH_INPUT]: 2, [SOURCE_INPUT]: 'high' });

  expect(emaValues(new EmaIndicator().load(twoBars, settings))).toEqual([null, 17]);
});

test('the hl2 source smooths the midpoint of high and low', () => {
  const twoBars = [barAt(0, 10, 12, 8), barAt(1, 20, 22, 18)];
  const settings = resolveSettingValues(emaPlugin, { [LENGTH_INPUT]: 2, [SOURCE_INPUT]: 'hl2' });

  expect(emaValues(new EmaIndicator().load(twoBars, settings))).toEqual([null, 15]);
});

test('a tick of the forming bar redraws it without moving the state', () => {
  const indicator = new EmaIndicator();
  indicator.load(CLOSES_THROUGH_TEN, LENGTH_THREE);

  const rising = indicator.update(barAt(3, 20), LENGTH_THREE);
  const falling = indicator.update(barAt(3, 10), LENGTH_THREE);

  expect(emaValues(rising)).toEqual([12]);
  expect(emaValues(falling)).toEqual([7]);
  expect(falling.bars.map((bar) => bar.confirmed)).toEqual([false]);
});

test('a newer bar closes the forming one and smooths on from its close', () => {
  const indicator = new EmaIndicator();
  indicator.load(CLOSES_THROUGH_TEN, LENGTH_THREE);
  indicator.update(barAt(3, 20), LENGTH_THREE);
  indicator.update(barAt(3, 10), LENGTH_THREE);

  const frame = indicator.update(barAt(4, 2), LENGTH_THREE);

  expect(emaValues(frame)).toEqual([7, 4.5]);
  expect(frame.bars.map((bar) => bar.confirmed)).toEqual([true, false]);
});

test('a bar older than the forming one draws nothing', () => {
  const indicator = new EmaIndicator();
  indicator.load(CLOSES_THROUGH_TEN, LENGTH_THREE);

  expect(indicator.update(barAt(2, 5), LENGTH_THREE).bars).toEqual([]);
});

test('a newer bar returns the one it closed, confirmed, and then itself, still forming', () => {
  expectNewerBarClosesTheFormingOne(new EmaIndicator(), barsFromCloses([1, 2, 3, 4]), LENGTH_THREE);
});

test('the EMA line starts in the style defaults', () => {
  const frame = new EmaIndicator().load(barsFromCloses([2]), resolveSettingValues(emaPlugin, {}));

  expect(frame.plots).toEqual([DEFAULT_PLOT]);
});

test('the plugin registers on the price pane and titles itself EMA 9 close', () => {
  expect(findChartIndicatorPlugin(INDICATOR_ID)).toBe(emaPlugin);
  expect(emaPlugin.pane).toBe('overlay');
  expect(indicatorLegendTitle(INDICATOR_ID, resolveSettingValues(emaPlugin, {}))).toBe('EMA 9 close');
});
