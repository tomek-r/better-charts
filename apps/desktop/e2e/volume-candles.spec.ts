import { expect, test } from '@playwright/test';
import type { UTCTimestamp } from 'lightweight-charts';
import { volumeCandleColors } from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandleColors';
import { volumeCandleWidth } from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandleWidth';
import {
  VOLUME_CANDLES_DEFAULT_OPTIONS,
  type VolumeCandlesOptions,
} from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandlesOptions';
import type { VolumeCandlePoint } from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandlePoint';

/**
 * How a volume candle is drawn: the width of its body, a share of the widest body on screen that grows with
 * the bar's volume, and the colours of its body, its border and its wick.
 */

/** The widest body these tests scale, ten device pixels, so every share is a round number of pixels. */
const FULL_WIDTH = 10;
/** What the busiest bar of a window can hold. */
const BUSIEST_VOLUME = 500;

/** The colours a candle may name of its own: the body, the border and the wick. */
type OwnColors = Pick<VolumeCandlePoint, 'color' | 'borderColor' | 'wickColor'>;

/** Every candle colour is a name of its own, so a test can tell which part took which colour. */
const CANDLE_COLORS: VolumeCandlesOptions = {
  ...VOLUME_CANDLES_DEFAULT_OPTIONS,
  upColor: 'up-body',
  downColor: 'down-body',
  borderUpColor: 'up-border',
  borderDownColor: 'down-border',
  wickUpColor: 'up-wick',
  wickDownColor: 'down-wick',
};

/** A volume candle from `open` to `close`, with a high and a low around them and the colours it names. */
function volumeCandle(open: number, close: number, ownColors: Partial<OwnColors> = {}): VolumeCandlePoint {
  return {
    time: 0 as UTCTimestamp,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: BUSIEST_VOLUME,
    ...ownColors,
  };
}

test('the busiest visible bar fills the whole body width', () => {
  expect(volumeCandleWidth(BUSIEST_VOLUME, BUSIEST_VOLUME, FULL_WIDTH)).toBe(FULL_WIDTH);
});

test('a bar of half the busiest volume draws six tenths of the body width', () => {
  // 0.2 + 0.8 * 0.5 = 0.6 of the width, which is the share the thinnest and the widest bar span.
  expect(volumeCandleWidth(BUSIEST_VOLUME / 2, BUSIEST_VOLUME, FULL_WIDTH)).toBe(6);
});

test('a bar of no volume keeps a fifth of the body width, and never less than a pixel', () => {
  expect(volumeCandleWidth(0, BUSIEST_VOLUME, FULL_WIDTH)).toBe(2);
  // A fifth of two device pixels rounds to nothing, so the narrowest body a bar can have is one pixel.
  expect(volumeCandleWidth(0, BUSIEST_VOLUME, 2)).toBe(1);
});

test('a window whose visible bars hold no volume draws every body at the full width', () => {
  expect(volumeCandleWidth(0, 0, FULL_WIDTH)).toBe(FULL_WIDTH);
});

test('a rising candle without colours of its own takes the rising body, border and wick', () => {
  expect(volumeCandleColors(CANDLE_COLORS, volumeCandle(10, 12))).toEqual({
    body: 'up-body',
    border: 'up-border',
    wick: 'up-wick',
  });
});

test('a falling candle without colours of its own takes the falling body, border and wick', () => {
  expect(volumeCandleColors(CANDLE_COLORS, volumeCandle(12, 10))).toEqual({
    body: 'down-body',
    border: 'down-border',
    wick: 'down-wick',
  });
});

test('a candle that names its own colours keeps them', () => {
  const point = volumeCandle(12, 10, { color: 'own-body', borderColor: 'own-border', wickColor: 'own-wick' });
  expect(volumeCandleColors(CANDLE_COLORS, point)).toEqual({
    body: 'own-body',
    border: 'own-border',
    wick: 'own-wick',
  });
});

test('a candle with a hidden body still draws its border and wick in the rising colours', () => {
  expect(volumeCandleColors(CANDLE_COLORS, volumeCandle(10, 12, { color: 'transparent' }))).toEqual({
    body: 'transparent',
    border: 'up-border',
    wick: 'up-wick',
  });
});
