import type { SettingValues } from '../chart/engine/settings/settingInputs';
import type { ChartIndicatorPlugin } from './chartIndicatorPlugin';
import { findChartIndicatorPlugin } from './registry';

const WORD_SEPARATOR = ' ';

/**
 * The legend's words for an attached indicator before its values: the plugin's short title, then
 * the declared inputs in order, e.g. "SMA 9 close"; an unregistered definition reads as its id.
 */
export function indicatorLegendTitle(definitionId: string, settings: SettingValues): string {
  const plugin: ChartIndicatorPlugin | undefined = findChartIndicatorPlugin(definitionId);
  if (plugin === undefined) {
    return definitionId;
  }
  const words = [plugin.shortTitle];
  for (const input of plugin.inputs ?? []) {
    // Stored settings can predate an input the definition declares now, so an absent one is skipped.
    const value: SettingValues[string] | undefined = settings[input.id];
    if (value !== undefined) {
      words.push(String(value));
    }
  }
  return words.join(WORD_SEPARATOR);
}
