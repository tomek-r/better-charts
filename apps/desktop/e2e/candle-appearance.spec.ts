import { expect, test } from '@playwright/test';
import {
  DEFAULT_CANDLE_APPEARANCE,
  candlePointColors,
  candleSeriesColors,
  type CandleAppearance,
} from '../src/features/chart/engine/bars/candleAppearance';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { candleAppearanceOf } from '../src/features/chart/chartSettings/candleAppearanceSetting';
import { DEFAULT_CHART_SETTINGS } from '../src/features/chart/chartSettings/chartSettings';

/**
 * What the candle settings mean to the engine: the colours the series and each point take, and the
 * settings-to-appearance mapping. The palette literals are the ones the chart has always drawn, so a
 * default chart looks the same as it did before the settings existed.
 */

const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#f7525f';
const BAR_TIME_SECONDS = 1_700_000_000;
const COLORING_BY_PREVIOUS_CLOSE: CandleAppearance = { ...DEFAULT_CANDLE_APPEARANCE, colorByPreviousClose: true };

/** One bar of the chart's own shape; only the open and the close decide the colour it takes. */
function barAt(open: number, close: number): RenderBar {
  return {
    time: BAR_TIME_SECONDS,
    open,
    close,
    high: Math.max(open, close),
    low: Math.min(open, close),
    volume: 100,
  };
}

test('the default candle appearance is the palette pair with borders off', () => {
  expect(candleSeriesColors(DEFAULT_CANDLE_APPEARANCE)).toEqual({
    upColor: UP_COLOR,
    downColor: DOWN_COLOR,
    borderVisible: false,
    borderUpColor: UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickVisible: true,
    wickUpColor: UP_COLOR,
    wickDownColor: DOWN_COLOR,
  });
  expect(DEFAULT_CANDLE_APPEARANCE.colorByPreviousClose).toBe(false);
});

test('a hidden body paints no colour, because the series has no body switch', () => {
  const hiddenBody: CandleAppearance = {
    ...DEFAULT_CANDLE_APPEARANCE,
    body: { ...DEFAULT_CANDLE_APPEARANCE.body, visible: false },
  };

  const colors = candleSeriesColors(hiddenBody);

  expect(colors.upColor).toBe('transparent');
  expect(colors.downColor).toBe('transparent');
  expect(colors.wickVisible).toBe(true);
});

test('bars keep the series colours while colouring by the previous close is off', () => {
  const previous = barAt(1.1, 1.2);
  const bar = barAt(1.15, 1.18);

  expect(candlePointColors(DEFAULT_CANDLE_APPEARANCE, bar, previous)).toEqual({});
});

test('a bar is coloured by the previous close, not by its own open', () => {
  // Closes below the previous close, yet above its own open: the previous close decides.
  const previous = barAt(1.1, 1.2);
  const bar = barAt(1.15, 1.18);

  expect(candlePointColors(COLORING_BY_PREVIOUS_CLOSE, bar, previous)).toEqual({
    color: DOWN_COLOR,
    borderColor: DOWN_COLOR,
    wickColor: DOWN_COLOR,
  });
});

test('a bar closing at or above the previous close takes the up colours', () => {
  const previous = barAt(1.2, 1.1);
  const bar = barAt(1.05, 1.1);

  expect(candlePointColors(COLORING_BY_PREVIOUS_CLOSE, bar, previous).color).toBe(UP_COLOR);
});

test('the first bar has no previous close, so it is read against its own open', () => {
  const rising = candlePointColors(COLORING_BY_PREVIOUS_CLOSE, barAt(1.1, 1.12), undefined);
  const falling = candlePointColors(COLORING_BY_PREVIOUS_CLOSE, barAt(1.12, 1.1), undefined);

  expect(rising.color).toBe(UP_COLOR);
  expect(falling.color).toBe(DOWN_COLOR);
});

test('the default candle settings map onto the default appearance', () => {
  expect(candleAppearanceOf(DEFAULT_CHART_SETTINGS.barStyles.candles)).toEqual(DEFAULT_CANDLE_APPEARANCE);
});

test('candle settings that were chosen are what the candles are drawn with', () => {
  const candles = {
    ...DEFAULT_CHART_SETTINGS.barStyles.candles,
    colorByPreviousClose: true,
    body: { visible: true, up: '#00ff00', down: '#ff00ff' },
  };

  const appearance = candleAppearanceOf(candles);

  expect(appearance.colorByPreviousClose).toBe(true);
  expect(appearance.body).toEqual({ visible: true, up: '#00ff00', down: '#ff00ff' });
});

test('a candle part stored in the wrong shape falls back to the default part', () => {
  const candles = { ...DEFAULT_CHART_SETTINGS.barStyles.candles, body: 'not a colour pair' };

  const appearance = candleAppearanceOf(candles);

  expect(appearance.body).toEqual(DEFAULT_CANDLE_APPEARANCE.body);
  expect(appearance.wick).toEqual(DEFAULT_CANDLE_APPEARANCE.wick);
});
