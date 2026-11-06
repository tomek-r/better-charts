import { indicatorDisplayOf } from '../chart/engine/indicators/indicatorDisplaySettings';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import type { ChartIndicatorPlugin } from './chartIndicatorPlugin';
import { findChartIndicatorPlugin } from './registry';

const WORD_SEPARATOR = ' ';

/**
 * The legend's words for an attached indicator before its values: the plugin's short title, then the
 * inputs it names in order, e.g. "SMA 9 close"; an unregistered definition reads as its id.
 */
export function indicatorLegendTitle(definitionId: string, settings: SettingValues): string {
  const plugin: ChartIndicatorPlugin | undefined = findChartIndicatorPlugin(definitionId);
  if (plugin === undefined) {
    return definitionId;
  }
  const named = plugin.legendInputIds?.(settings);
  const words = [plugin.shortTitle];
  for (const input of plugin.inputs ?? []) {
    if (named !== undefined && !named.includes(input.id)) {
      continue;
    }
    // Stored settings can predate an input the definition declares now, so an absent one is skipped.
    const value: SettingValues[string] | undefined = settings[input.id];
    if (value !== undefined) {
      words.push(String(value));
    }
  }
  return words.join(WORD_SEPARATOR);
}

/**
 * The legend row's words: the short title with the inputs after it while the indicator shows them in its
 * status line, e.g. "SMA 9 close", and the bare short title otherwise. An unregistered definition reads as
 * its id.
 */
export function indicatorStatusLineTitle(definitionId: string, settings: SettingValues): string {
  if (indicatorDisplayOf(settings).inputsInStatusLine) {
    return indicatorLegendTitle(definitionId, settings);
  }
  return findChartIndicatorPlugin(definitionId)?.shortTitle ?? definitionId;
}
