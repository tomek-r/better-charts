import type { IndicatorLineStyle, IndicatorPlot } from '../chart/engine/indicators/indicatorFrame';
import {
  SETTING_INPUT_SOURCES,
  type SettingInputSource,
  type SettingValues,
} from '../chart/engine/settings/settingInputs';
import { SETTING_STYLE_LINE_STYLES, settingStyleKey } from '../chart/engine/settings/settingStyles';

const DEFAULT_LINE_STYLE: IndicatorLineStyle = 'solid';
const DEFAULT_PLOT_VISIBLE = true;

/**
 * Settings arrive resolved, so the fallback only covers a stored value of the
 * wrong kind.
 */
export function numberSetting(settings: SettingValues, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' ? value : fallback;
}

/** Settings arrive resolved, so the fallback only covers a value of the wrong kind. */
export function stringSetting(settings: SettingValues, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : fallback;
}

/** Settings arrive resolved, so the fallback only covers a value of the wrong kind. */
export function booleanSetting(settings: SettingValues, key: string, fallback: boolean): boolean {
  const value = settings[key];
  return typeof value === 'boolean' ? value : fallback;
}

function isSettingInputSource(value: string): value is SettingInputSource {
  return (SETTING_INPUT_SOURCES as readonly string[]).includes(value);
}

/** The price a `source` input names, or `fallback` when the stored text names no source. */
export function sourceSetting(settings: SettingValues, key: string, fallback: SettingInputSource): SettingInputSource {
  const source = stringSetting(settings, key, fallback);
  return isSettingInputSource(source) ? source : fallback;
}

function isLineStyle(value: string): value is IndicatorLineStyle {
  return (SETTING_STYLE_LINE_STYLES as readonly string[]).includes(value);
}

/** A `line` style's dash pattern, or `solid` when the stored text names no pattern. */
function lineStyleSetting(settings: SettingValues, styleId: string): IndicatorLineStyle {
  const lineStyle = stringSetting(settings, settingStyleKey(styleId, 'style'), DEFAULT_LINE_STYLE);
  return isLineStyle(lineStyle) ? lineStyle : DEFAULT_LINE_STYLE;
}

/** The plot a `line` style draws, in the style's values or, when one is missing, the given default. */
export function linePlotSetting(
  settings: SettingValues,
  styleId: string,
  plot: { title: string; color: string; width: number },
): IndicatorPlot {
  return {
    title: plot.title,
    style: 'line',
    color: stringSetting(settings, settingStyleKey(styleId, 'color'), plot.color),
    lineWidth: numberSetting(settings, settingStyleKey(styleId, 'width'), plot.width),
    lineStyle: lineStyleSetting(settings, styleId),
    visible: booleanSetting(settings, settingStyleKey(styleId, 'visible'), DEFAULT_PLOT_VISIBLE),
  };
}
