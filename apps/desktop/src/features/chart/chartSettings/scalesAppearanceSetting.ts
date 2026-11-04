import {
  BID_ASK_DRAWING_MODES,
  DEFAULT_CHART_SCALES_APPEARANCE,
  PRICE_SCALE_MODES,
  SCALE_BUTTON_MODES,
  type ChartBidAskAppearance,
  type ChartScalesAppearance,
} from '../engine/surface/chartScalesAppearance';
import { CHART_DATE_FORMATS, CHART_HOUR_FORMATS, type ChartTimeLabels } from '../timeZone/chartTimeFormat';
import type { ScalesSettingValues } from './chartSettings';
import { isSettingRecord, readBoolean, readColor, readOption } from './settingValueReaders';

/** The Bid/Ask drawing as stored, each field that does not read falling back to the default one. */
function readBidAsk(raw: unknown): ChartBidAskAppearance {
  const fallback = DEFAULT_CHART_SCALES_APPEARANCE.bidAsk;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return {
    mode: readOption(raw.mode, BID_ASK_DRAWING_MODES, fallback.mode),
    bid: readColor(raw.bid, fallback.bid),
    ask: readColor(raw.ask, fallback.ask),
  };
}

/**
 * How the labels write a time, each field that does not read falling back to its default: the time
 * scale's three fields are what the axis, the pointer and the footer clock write with.
 */
export function chartTimeLabelsOf(scales: ScalesSettingValues): ChartTimeLabels {
  const fallback = DEFAULT_CHART_SCALES_APPEARANCE.timeLabels;
  return {
    dayOfWeek: readBoolean(scales.dayOfWeek, fallback.dayOfWeek),
    dateFormat: readOption(scales.dateFormat, CHART_DATE_FORMATS, fallback.dateFormat),
    hourFormat: readOption(scales.hourFormat, CHART_HOUR_FORMATS, fallback.hourFormat),
  };
}

/** The chart the scales settings draw, each field that does not read falling back to its default. */
export function scalesAppearanceOf(scales: ScalesSettingValues): ChartScalesAppearance {
  const defaults = DEFAULT_CHART_SCALES_APPEARANCE;
  return {
    scaleModeButtons: readOption(scales.scaleModeButtons, SCALE_BUTTON_MODES, defaults.scaleModeButtons),
    countdown: readBoolean(scales.countdown, defaults.countdown),
    bidAsk: readBidAsk(scales.bidAsk),
    timeLabels: chartTimeLabelsOf(scales),
    invertScale: readBoolean(scales.invertScale, defaults.invertScale),
    priceScaleMode: readOption(scales.priceScaleMode, PRICE_SCALE_MODES, defaults.priceScaleMode),
    symbolNameLabel: readBoolean(scales.symbolNameLabel, defaults.symbolNameLabel),
  };
}
