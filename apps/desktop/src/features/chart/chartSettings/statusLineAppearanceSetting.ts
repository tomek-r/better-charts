import {
  DEFAULT_STATUS_LINE_APPEARANCE,
  STATUS_LINE_TITLE_FORMATS,
  type ChartStatusLineAppearance,
} from '../engine/legend/statusLineAppearance';
import type { StatusLineSettingValues } from './chartSettings';
import { isSettingRecord, readBoolean, readColor, readOption } from './settingValueReaders';

type StatusLineBackground = ChartStatusLineAppearance['background'];

/** The stored background, which keeps its own visibility switch beside its colour. */
function backgroundOf(raw: unknown): StatusLineBackground {
  const fallback = DEFAULT_STATUS_LINE_APPEARANCE.background;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return { visible: readBoolean(raw.visible, fallback.visible), color: readColor(raw.color, fallback.color) };
}

/** The Status line tab's stored values read back as the appearance the legend applies, field by field. */
export function statusLineAppearanceOf(values: StatusLineSettingValues): ChartStatusLineAppearance {
  const defaults = DEFAULT_STATUS_LINE_APPEARANCE;
  return {
    title: readBoolean(values.title, defaults.title),
    titleFormat: readOption(values.titleFormat, STATUS_LINE_TITLE_FORMATS, defaults.titleFormat),
    marketStatus: readBoolean(values.marketStatus, defaults.marketStatus),
    chartValues: readBoolean(values.chartValues, defaults.chartValues),
    barChange: readBoolean(values.barChange, defaults.barChange),
    volume: readBoolean(values.volume, defaults.volume),
    lastDayChange: readBoolean(values.lastDayChange, defaults.lastDayChange),
    indicatorTitles: readBoolean(values.indicatorTitles, defaults.indicatorTitles),
    indicatorInputs: readBoolean(values.indicatorInputs, defaults.indicatorInputs),
    indicatorValues: readBoolean(values.indicatorValues, defaults.indicatorValues),
    indicatorLegendCollapsed: readBoolean(values.indicatorLegendCollapsed, defaults.indicatorLegendCollapsed),
    background: backgroundOf(values.background),
  };
}
