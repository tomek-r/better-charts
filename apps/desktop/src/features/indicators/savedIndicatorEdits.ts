import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { SettingValues } from '../chart/engine/settings/settingInputs';

/**
 * Marks one saved indicator as hidden (or shown again) without touching the other entries.
 *
 * A shown entry carries no `hidden` key at all, so showing rebuilds the entry from its saved fields.
 */
export function withIndicatorHidden(
  indicators: readonly SavedIndicator[],
  instanceId: string,
  hidden: boolean,
): SavedIndicator[] {
  return indicators.map((indicator) => {
    if (indicator.instanceId !== instanceId) {
      return indicator;
    }
    if (hidden) {
      return { ...indicator, hidden: true };
    }
    const { instanceId: savedInstanceId, definitionId, settings } = indicator;
    return { instanceId: savedInstanceId, definitionId, settings };
  });
}

/**
 * Replaces the settings of one saved indicator, leaving the other entries untouched.
 */
export function withIndicatorSettings(
  indicators: readonly SavedIndicator[],
  instanceId: string,
  settings: SettingValues,
): SavedIndicator[] {
  return indicators.map((indicator) => {
    if (indicator.instanceId !== instanceId) {
      return indicator;
    }
    return { ...indicator, settings };
  });
}

/**
 * Drops one saved indicator, leaving the other entries untouched.
 */
export function withoutIndicator(indicators: readonly SavedIndicator[], instanceId: string): SavedIndicator[] {
  return indicators.filter((indicator) => indicator.instanceId !== instanceId);
}
