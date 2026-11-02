import {
  DEFAULT_CHART_APPEARANCE,
  type ChartAppearance,
  type ChartBackgroundAppearance,
  type ChartLineAppearance,
  type ChartScaleTextAppearance,
  type ChartToggledLineAppearance,
} from '../engine/surface/chartAppearance';
import type { CanvasSettingValues } from './chartSettings';
import { BACKGROUND_FILL_MODES, LINE_DASH_STYLES } from './settingFields';
import { isSettingRecord, readColor, readNumber, readOption } from './settingValueReaders';

/** One line as stored, each field that does not read falling back to the default one. */
function readLine(raw: unknown, fallback: ChartLineAppearance): ChartLineAppearance {
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return {
    color: readColor(raw.color, fallback.color),
    style: readOption(raw.style, LINE_DASH_STYLES, fallback.style),
  };
}

/** One line a checkbox shows and hides, its visibility falling back like the line itself. */
function readToggledLine(raw: unknown, fallback: ChartToggledLineAppearance): ChartToggledLineAppearance {
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  const visible = typeof raw.visible === 'boolean' ? raw.visible : fallback.visible;
  return { visible, ...readLine(raw, fallback) };
}

/** The background fill as stored: one colour, or a gradient between its two. */
function readBackground(raw: unknown): ChartBackgroundAppearance {
  const fallback = DEFAULT_CHART_APPEARANCE.background;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return {
    mode: readOption(raw.mode, BACKGROUND_FILL_MODES, fallback.mode),
    color: readColor(raw.color, fallback.color),
    bottomColor: readColor(raw.bottomColor, fallback.bottomColor),
  };
}

function readScaleText(raw: unknown): ChartScaleTextAppearance {
  const fallback = DEFAULT_CHART_APPEARANCE.scaleText;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return { color: readColor(raw.color, fallback.color), fontSize: readNumber(raw.fontSize, fallback.fontSize) };
}

/** The chart the Canvas tab's settings draw, each field that does not read falling back to its default. */
export function chartAppearanceOf(canvas: CanvasSettingValues): ChartAppearance {
  const defaults = DEFAULT_CHART_APPEARANCE;
  return {
    background: readBackground(canvas.background),
    verticalGrid: readToggledLine(canvas.verticalGrid, defaults.verticalGrid),
    horizontalGrid: readToggledLine(canvas.horizontalGrid, defaults.horizontalGrid),
    crosshair: readLine(canvas.crosshair, defaults.crosshair),
    scaleText: readScaleText(canvas.scaleText),
    scaleLines: readColor(canvas.scaleLines, defaults.scaleLines),
    topMarginPercent: readNumber(canvas.topMargin, defaults.topMarginPercent),
    bottomMarginPercent: readNumber(canvas.bottomMargin, defaults.bottomMarginPercent),
    rightMarginBars: readNumber(canvas.rightMargin, defaults.rightMarginBars),
  };
}
