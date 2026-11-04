import { expect, test } from '@playwright/test';
import type { UTCTimestamp } from 'lightweight-charts';
import { volumeCandleColors } from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandleColors';
import {
  volumeCandleWidth,
  type VisibleVolumeRange,
} from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandleWidth';
import {
  VOLUME_CANDLES_DEFAULT_OPTIONS,
  type VolumeCandlesOptions,
} from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandlesOptions';
import type { VolumeCandlePoint } from '../src/features/chart/engine/barStyle/volumeCandles/volumeCandlePoint';

/**
 * How a volume candle is drawn: the width of its body, a share of the widest body on screen that grows from the
 * quietest visible bar towards the busiest one, and the colours of its body, its border and its wick.
 */

/** The widest body these tests scale, twenty device pixels, so every share is a round number of pixels. */
const FULL_WIDTH = 20;
/** The volumes the visible bars of a window trade between in these width tests. */
const VISIBLE_VOLUMES: VisibleVolumeRange = { min: 800, max: 1000 };
/** The sensitivity the setting offers by default, which leaves the quietest visible bar a fifth of the body width. */
const DEFAULT_WIDTH_SENSITIVITY = 0.8;
/** The full sensitivity, which narrows the quietest visible bar to the narrowest body. */
const FULL_WIDTH_SENSITIVITY = 1;
/** A sensitivity that leaves every body at the full width. */
const NO_WIDTH_SENSITIVITY = 0;
/** The volume the colour tests' bars trade, which no colour rule reads. */
const CANDLE_VOLUME = 500;

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
    volume: CANDLE_VOLUME,
    ...ownColors,
  };
}

test('the busiest visible bar fills the whole body width at the default sensitivity', () => {
  expect(volumeCandleWidth(1000, VISIBLE_VOLUMES, FULL_WIDTH, DEFAULT_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
});

test('the quietest visible bar keeps a fifth of the body width at the default sensitivity', () => {
  // 1 - 0.8 * (1 - 0) = 0.2 of the twenty device pixels.
  expect(volumeCandleWidth(800, VISIBLE_VOLUMES, FULL_WIDTH, DEFAULT_WIDTH_SENSITIVITY)).toBe(4);
});

test('a bar halfway up the visible range draws three fifths of the body width at the default sensitivity', () => {
  // 1 - 0.8 * (1 - 0.5) = 0.6 of the twenty device pixels.
  expect(volumeCandleWidth(900, VISIBLE_VOLUMES, FULL_WIDTH, DEFAULT_WIDTH_SENSITIVITY)).toBe(12);
});

test('the quietest visible bar narrows to the narrowest body at full sensitivity', () => {
  expect(volumeCandleWidth(800, VISIBLE_VOLUMES, FULL_WIDTH, FULL_WIDTH_SENSITIVITY)).toBe(1);
});

test('a bar halfway up the visible range draws half the body width at full sensitivity', () => {
  // (900 - 800) / (1000 - 800) = 0.5, so 1 - 1 * (1 - 0.5) = 0.5 of the twenty device pixels.
  expect(volumeCandleWidth(900, VISIBLE_VOLUMES, FULL_WIDTH, FULL_WIDTH_SENSITIVITY)).toBe(10);
});

test('a sensitivity of zero draws every body at the full width', () => {
  expect(volumeCandleWidth(800, VISIBLE_VOLUMES, FULL_WIDTH, NO_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
  expect(volumeCandleWidth(1000, VISIBLE_VOLUMES, FULL_WIDTH, NO_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
});

test('a window whose visible bars all traded the same volume draws every body at the full width', () => {
  // Nothing to compare the volumes against, so the sensitivity has no body to narrow.
  const equalVolumes: VisibleVolumeRange = { min: 500, max: 500 };
  expect(volumeCandleWidth(500, equalVolumes, FULL_WIDTH, DEFAULT_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
});

test('a window whose visible bars hold no volume draws every body at the full width', () => {
  const noVolumes: VisibleVolumeRange = { min: 0, max: 0 };
  expect(volumeCandleWidth(0, noVolumes, FULL_WIDTH, DEFAULT_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
  expect(volumeCandleWidth(0, noVolumes, FULL_WIDTH, NO_WIDTH_SENSITIVITY)).toBe(FULL_WIDTH);
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
