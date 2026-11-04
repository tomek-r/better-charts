import { expect, test } from '@playwright/test';
import { DEFAULT_CANDLE_APPEARANCE } from '../src/features/chart/engine/bars/candleAppearance';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import {
  barStylePoint,
  barStylePoints,
  type BarStylePoint,
} from '../src/features/chart/engine/barStyle/barStylePoints';
import { PRICE_SOURCES, priceAt } from '../src/features/chart/engine/barStyle/priceSource';
import { barStyleAppearanceOf } from '../src/features/chart/chartSettings/barStyleAppearanceSetting';
import { DEFAULT_CHART_SETTINGS } from '../src/features/chart/chartSettings/chartSettings';
import { palette } from '../src/shared/theme/palette';

/**
 * What a bar style means to the engine: the price one bar plots, the colours each style gives it, and
 * the settings-to-appearance mapping. The palette literals are the ones the chart has always drawn.
 */

const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#f7525f';
const BAR_TIME_SECONDS = 1_700_000_000;
const TRANSPARENT = 'transparent';

/** One bar of the chart's own shape; its open and close decide the colour, its range the price sources. */
function barAt(open: number, close: number, high = Math.max(open, close), low = Math.min(open, close)): RenderBar {
  return { time: BAR_TIME_SECONDS, open, high, low, close, volume: 100 };
}

/** The colour one point writes; every point these tests colour carries one. */
function pointColor(point: BarStylePoint): string | undefined {
  return 'color' in point ? point.color : undefined;
}

/** The per-point colours a candle or a bar point carries; the library keeps them optional. */
function pointColors(point: BarStylePoint) {
  return {
    color: 'color' in point ? point.color : undefined,
    borderColor: 'borderColor' in point ? point.borderColor : undefined,
    wickColor: 'wickColor' in point ? point.wickColor : undefined,
  };
}

/** The value a single-value point plots, which is all the line, area and column styles write. */
function pointValue(point: BarStylePoint): number | undefined {
  return 'value' in point ? point.value : undefined;
}

test('every price source reads the number the bar holds under it', () => {
  const bar = barAt(1.2, 1.15, 1.3, 1.1);

  expect(priceAt(bar, 'open')).toBe(1.2);
  expect(priceAt(bar, 'high')).toBe(1.3);
  expect(priceAt(bar, 'low')).toBe(1.1);
  expect(priceAt(bar, 'close')).toBe(1.15);
  // (H + L)/2, (H + L + C)/3 and (O + H + L + C)/4, worked out by hand for this bar.
  expect(priceAt(bar, 'hl2')).toBeCloseTo(1.2, 10);
  expect(priceAt(bar, 'hlc3')).toBeCloseTo(1.18333, 5);
  expect(priceAt(bar, 'ohlc4')).toBeCloseTo(1.1875, 10);
  expect(PRICE_SOURCES).toEqual(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4']);
});

test('the default settings of every style map onto the appearance the engine draws', () => {
  const defaults = DEFAULT_CHART_SETTINGS.barStyles;

  expect(barStyleAppearanceOf('candles', defaults.candles)).toEqual({
    style: 'candles',
    candles: DEFAULT_CANDLE_APPEARANCE,
  });
  expect(barStyleAppearanceOf('hollowCandles', defaults.hollowCandles)).toEqual({
    style: 'hollowCandles',
    candles: DEFAULT_CANDLE_APPEARANCE,
  });
  expect(barStyleAppearanceOf('heikinAshi', defaults.heikinAshi)).toEqual({
    style: 'heikinAshi',
    candles: DEFAULT_CANDLE_APPEARANCE,
  });
  // The baseline turns around the middle of the price scale until its own level is saved otherwise.
  expect(barStyleAppearanceOf('baseline', defaults.baseline)).toMatchObject({ style: 'baseline', baseLevel: 50 });
  expect(barStyleAppearanceOf('bars', defaults.bars)).toEqual({
    style: 'bars',
    colorByPreviousClose: false,
    colors: { up: UP_COLOR, down: DOWN_COLOR },
    thinBars: true,
    hlcBars: false,
  });
  for (const style of ['line', 'lineWithMarkers', 'stepLine'] as const) {
    expect(barStyleAppearanceOf(style, defaults[style])).toEqual({
      style,
      priceSource: 'close',
      color: palette.info,
      lineWidth: 2,
    });
  }
  expect(barStyleAppearanceOf('area', defaults.area)).toEqual({
    style: 'area',
    priceSource: 'close',
    lineColor: palette.info,
    lineWidth: 2,
    fillTop: palette.infoWash,
    fillBottom: palette.infoClear,
  });
  expect(barStyleAppearanceOf('columns', defaults.columns)).toEqual({
    style: 'columns',
    colorByPreviousClose: false,
    colors: { up: UP_COLOR, down: DOWN_COLOR },
  });
});

test('a setting stored in the wrong shape falls back to the default of its own field', () => {
  const line = { ...DEFAULT_CHART_SETTINGS.barStyles.line, priceSource: 'nonsense', lineWidth: 17, lineColor: 42 };

  expect(barStyleAppearanceOf('line', line)).toEqual({
    style: 'line',
    priceSource: 'close',
    color: palette.info,
    lineWidth: 2,
  });
});

test('bars take the colour of their own open unless the style colours by the previous close', () => {
  const bars = barStyleAppearanceOf('bars', DEFAULT_CHART_SETTINGS.barStyles.bars);
  const coloringByPreviousClose = barStyleAppearanceOf('bars', {
    ...DEFAULT_CHART_SETTINGS.barStyles.bars,
    colorByPreviousClose: true,
  });
  // Above its own open, yet below the previous close: the two rules disagree on this bar.
  const previous = barAt(1.2, 1.25);
  const bar = barAt(1.1, 1.15);

  expect(pointColor(barStylePoint(bars, bar, previous))).toBe(UP_COLOR);
  expect(pointColor(barStylePoint(coloringByPreviousClose, bar, previous))).toBe(DOWN_COLOR);
  // The first bar has no previous close, so both rules read it against its own open.
  expect(pointColor(barStylePoint(coloringByPreviousClose, bar, undefined))).toBe(UP_COLOR);
});

test('columns plot the close, coloured by the rule their style was saved with', () => {
  const columns = barStyleAppearanceOf('columns', {
    ...DEFAULT_CHART_SETTINGS.barStyles.columns,
    colorByPreviousClose: true,
  });
  const previous = barAt(1.2, 1.25);
  const bar = barAt(1.1, 1.15);

  const point = barStylePoint(columns, bar, previous);

  expect(pointValue(point)).toBe(1.15);
  expect(pointColor(point)).toBe(DOWN_COLOR);
});

test('a hollow candle above its own open keeps its hole and takes the up outlines', () => {
  const hollowCandles = barStyleAppearanceOf('hollowCandles', DEFAULT_CHART_SETTINGS.barStyles.hollowCandles);
  const previous = barAt(1.0, 1.05);
  const bar = barAt(1.1, 1.15);

  expect(pointColors(barStylePoint(hollowCandles, bar, previous))).toEqual({
    color: TRANSPARENT,
    borderColor: UP_COLOR,
    wickColor: UP_COLOR,
  });
});

test('a candle that closed below its open is filled in the down colours', () => {
  const hollowCandles = barStyleAppearanceOf('hollowCandles', DEFAULT_CHART_SETTINGS.barStyles.hollowCandles);
  const previous = barAt(1.2, 1.25);
  const bar = barAt(1.15, 1.1);

  expect(pointColors(barStylePoint(hollowCandles, bar, previous))).toEqual({
    color: DOWN_COLOR,
    borderColor: DOWN_COLOR,
    wickColor: DOWN_COLOR,
  });
});

test('a candle hollow above its own open but below the previous close is a down-coloured hole', () => {
  const hollowCandles = barStyleAppearanceOf('hollowCandles', DEFAULT_CHART_SETTINGS.barStyles.hollowCandles);
  const previous = barAt(1.2, 1.3);
  const bar = barAt(1.1, 1.15);

  expect(pointColors(barStylePoint(hollowCandles, bar, previous))).toEqual({
    color: TRANSPARENT,
    borderColor: DOWN_COLOR,
    wickColor: DOWN_COLOR,
  });
});

test('line points carry the price source the style was saved with', () => {
  const line = barStyleAppearanceOf('line', { ...DEFAULT_CHART_SETTINGS.barStyles.line, priceSource: 'hl2' });
  const bars = [barAt(1.1, 1.15, 1.25, 1.05), barAt(1.15, 1.2, 1.3, 1.1)];

  const values = barStylePoints(line, bars).map(pointValue);

  expect(values).toHaveLength(2);
  expect(values[0]).toBeCloseTo(1.15, 10);
  expect(values[1]).toBeCloseTo(1.2, 10);
});
