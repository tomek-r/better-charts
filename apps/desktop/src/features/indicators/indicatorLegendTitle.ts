import { indicatorDisplayOf } from '../chart/engine/indicators/indicatorDisplaySettings';
import type { IndicatorLegendWords } from '../chart/engine/legend/indicatorLegend';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { calculationTimeframeWord } from './calculation/calculationChoice';
import { CALCULATION_GROUP } from './calculation/calculationInputs';
import type { ChartIndicatorPlugin } from './chartIndicatorPlugin';
import { findChartIndicatorPlugin } from './registry';

const WORD_SEPARATOR = ' ';
const NO_INPUT_WORDS = '';

/**
 * The inputs an indicator names after its short title, in the order its definition lists them, then the
 * timeframe it is calculated on when it names one, e.g. "9 close 1H".
 */
function inputWordsOf(plugin: ChartIndicatorPlugin, settings: SettingValues): string {
  const named = plugin.legendInputIds?.(settings);
  const words: string[] = [];
  for (const input of plugin.inputs ?? []) {
    // The calculation inputs name no value of their own: the timeframe is one word after the others.
    if (input.group === CALCULATION_GROUP) {
      continue;
    }
    if (named !== undefined && !named.includes(input.id)) {
      continue;
    }
    // Stored settings can predate an input the definition declares now, so an absent one is skipped.
    const value: SettingValues[string] | undefined = settings[input.id];
    if (value !== undefined) {
      words.push(String(value));
    }
  }
  const timeframeWord = calculationTimeframeWord(settings);
  if (timeframeWord !== undefined) {
    words.push(timeframeWord);
  }
  return words.join(WORD_SEPARATOR);
}

/**
 * The legend's words for an attached indicator as the two runs it draws: the plugin's short title and the
 * inputs it names, e.g. "SMA" and "9 close 1H"; an unregistered definition reads as its id and names none.
 */
export function indicatorLegendWords(definitionId: string, settings: SettingValues): IndicatorLegendWords {
  const plugin: ChartIndicatorPlugin | undefined = findChartIndicatorPlugin(definitionId);
  if (plugin === undefined) {
    return { shortTitle: definitionId, inputs: NO_INPUT_WORDS };
  }
  return { shortTitle: plugin.shortTitle, inputs: inputWordsOf(plugin, settings) };
}

/** The legend's words as the one string the Object tree names the indicator with, e.g. "SMA 9 close 1H". */
export function indicatorLegendTitle(definitionId: string, settings: SettingValues): string {
  const { shortTitle, inputs } = indicatorLegendWords(definitionId, settings);
  if (inputs === NO_INPUT_WORDS) {
    return shortTitle;
  }
  return `${shortTitle}${WORD_SEPARATOR}${inputs}`;
}

/**
 * The legend row's words: the short title with the inputs after it while the indicator shows them in its
 * status line, and the bare short title otherwise. An unregistered definition reads as its id.
 */
export function indicatorStatusLineWords(definitionId: string, settings: SettingValues): IndicatorLegendWords {
  const words = indicatorLegendWords(definitionId, settings);
  if (indicatorDisplayOf(settings).inputsInStatusLine) {
    return words;
  }
  return { shortTitle: words.shortTitle, inputs: NO_INPUT_WORDS };
}
