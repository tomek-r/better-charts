import {
  DEFAULT_CANDLE_APPEARANCE,
  type CandleAppearance,
  type CandlePartAppearance,
} from '../engine/bars/candleAppearance';
import type { BarStyleSettingValues } from './chartSettings';
import { isSettingRecord } from './settingValueReaders';

const COLOR_BY_PREVIOUS_CLOSE_KEY = 'colorByPreviousClose';
const BODY_KEY = 'body';
const BORDERS_KEY = 'borders';
const WICK_KEY = 'wick';

function readColorByPreviousClose(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_CANDLE_APPEARANCE.colorByPreviousClose;
}

/** One candle part as stored, or the default part when the stored value does not hold its three fields. */
function readCandlePart(raw: unknown, fallback: CandlePartAppearance): CandlePartAppearance {
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  const { visible, up, down } = raw;
  if (typeof visible !== 'boolean' || typeof up !== 'string' || typeof down !== 'string') {
    return fallback;
  }
  return { visible, up, down };
}

/** The candles a bar style's settings draw, each unreadable part falling back to the default one. */
export function candleAppearanceOf(values: BarStyleSettingValues): CandleAppearance {
  return {
    colorByPreviousClose: readColorByPreviousClose(values[COLOR_BY_PREVIOUS_CLOSE_KEY]),
    body: readCandlePart(values[BODY_KEY], DEFAULT_CANDLE_APPEARANCE.body),
    borders: readCandlePart(values[BORDERS_KEY], DEFAULT_CANDLE_APPEARANCE.borders),
    wick: readCandlePart(values[WICK_KEY], DEFAULT_CANDLE_APPEARANCE.wick),
  };
}
