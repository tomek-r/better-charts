import { expect, test } from '@playwright/test';
import { ColorType, LineStyle } from 'lightweight-charts';
import { chartAppearanceOf } from '../src/features/chart/chartSettings/canvasAppearanceSetting';
import { DEFAULT_CHART_SETTINGS, type CanvasSettingValues } from '../src/features/chart/chartSettings/chartSettings';
import {
  chartLayoutOptions,
  DEFAULT_CHART_APPEARANCE,
  priceScaleMargins,
  type ChartAppearance,
} from '../src/features/chart/engine/surface/chartAppearance';
import { palette } from '../src/shared/theme/palette';

/**
 * The chart the Canvas tab's settings draw, as pure mappings: an appearance is the settings read
 * into the chart's own vocabulary, and the mappers turn it into chart options. Pure Node, so a wrong
 * default or a wrong library option name fails here rather than in a screenshot.
 */

/** The default appearance with the fields under test changed. */
function appearanceWith(change: Partial<ChartAppearance>): ChartAppearance {
  return { ...DEFAULT_CHART_APPEARANCE, ...change };
}

test('the default appearance is the chart as it has always looked', () => {
  const defaults = DEFAULT_CHART_APPEARANCE;

  expect(defaults.background).toEqual({ mode: 'solid', color: palette.overlay, bottomColor: palette.overlay });
  expect(defaults.verticalGrid).toEqual({ visible: true, color: palette.borderSubtle, style: 'solid' });
  expect(defaults.horizontalGrid).toEqual({ visible: true, color: palette.borderSubtle, style: 'solid' });
  expect(defaults.crosshair).toEqual({ color: palette.textLabel, style: 'solid', width: 1 });
  expect(defaults.scaleText).toEqual({ color: palette.mutedStrong, fontSize: 11 });
  expect(defaults.scaleLines).toBe(palette.border);
  expect([defaults.topMarginPercent, defaults.bottomMarginPercent]).toEqual([12, 18]);
  expect(defaults.rightMarginBars).toBe(5);
});

test('the default appearance maps to the options the surface opens the chart with', () => {
  const { layout, grid, rightPriceScale, timeScale } = chartLayoutOptions(DEFAULT_CHART_APPEARANCE);

  expect(layout).toEqual({
    background: { type: ColorType.Solid, color: palette.overlay },
    textColor: palette.mutedStrong,
    fontSize: 11,
  });
  expect(grid.vertLines).toEqual({ visible: true, color: palette.borderSubtle, style: LineStyle.Solid });
  expect(grid.horzLines).toEqual({ visible: true, color: palette.borderSubtle, style: LineStyle.Solid });
  expect(rightPriceScale.borderColor).toBe(palette.border);
  expect(timeScale.borderColor).toBe(palette.border);
});

test('a gradient background maps to the library gradient, top colour first', () => {
  const { layout } = chartLayoutOptions(
    appearanceWith({ background: { mode: 'gradient', color: '#101010', bottomColor: '#303030' } }),
  );

  expect(layout.background).toEqual({ type: ColorType.VerticalGradient, topColor: '#101010', bottomColor: '#303030' });
});

test('a dashed grid line and a dotted one map to their library line styles', () => {
  const grid = chartLayoutOptions(
    appearanceWith({
      verticalGrid: { ...DEFAULT_CHART_APPEARANCE.verticalGrid, style: 'dashed' },
      horizontalGrid: { ...DEFAULT_CHART_APPEARANCE.horizontalGrid, style: 'dotted' },
    }),
  ).grid;

  expect(grid.vertLines.style).toBe(LineStyle.LargeDashed);
  expect(grid.horzLines.style).toBe(LineStyle.Dotted);
});

test('the margins are the share of the pane the price fit leaves empty', () => {
  expect(priceScaleMargins(DEFAULT_CHART_APPEARANCE)).toEqual({ top: 0.12, bottom: 0.18 });
  expect(priceScaleMargins(appearanceWith({ topMarginPercent: 5, bottomMarginPercent: 10 }))).toEqual({
    top: 0.05,
    bottom: 0.1,
  });
});

test('the default canvas settings draw the default appearance', () => {
  expect(chartAppearanceOf(DEFAULT_CHART_SETTINGS.canvas)).toEqual(DEFAULT_CHART_APPEARANCE);
});

test('a canvas value that does not read falls back to its default, field by field', () => {
  const malformed: CanvasSettingValues = {
    crosshair: 'wavy',
    verticalGrid: 'nope',
    scaleText: 12,
    rightMargin: Number.NaN,
  };

  const appearance = chartAppearanceOf(malformed);

  expect(appearance.crosshair).toEqual(DEFAULT_CHART_APPEARANCE.crosshair);
  expect(appearance.verticalGrid).toEqual(DEFAULT_CHART_APPEARANCE.verticalGrid);
  expect(appearance.scaleText).toEqual(DEFAULT_CHART_APPEARANCE.scaleText);
  expect(appearance.rightMarginBars).toBe(DEFAULT_CHART_APPEARANCE.rightMarginBars);
  expect(appearance.horizontalGrid).toEqual(DEFAULT_CHART_APPEARANCE.horizontalGrid);
});

test('the crosshair keeps the thickness the Canvas tab sets, one pixel when it names none', () => {
  const seeded: CanvasSettingValues = { crosshair: { color: '#ff0000', style: 'dashed', width: 3 } };

  expect(chartAppearanceOf(seeded).crosshair).toEqual({ color: '#ff0000', style: 'dashed', width: 3 });
  expect(chartAppearanceOf({ crosshair: { color: '#ff0000', style: 'dashed' } }).crosshair.width).toBe(1);
  expect(chartAppearanceOf({ crosshair: { color: '#ff0000', style: 'dashed', width: 5 } }).crosshair.width).toBe(1);
});
