import { timeframeVisibilityField, type SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { SettingValues } from '../chart/engine/settings/settingInputs';

/**
 * Marks one saved indicator as hidden (or shown again) without touching the other entries.
 *
 * A shown entry carries no `hidden` key at all, so showing drops that one key and keeps every other field.
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
    return hidden ? { ...indicator, hidden: true } : withoutHiddenFlag(indicator);
  });
}

/**
 * Replaces the settings of one saved indicator and, when the caller names them, the timeframes it shows on,
 * leaving the other entries untouched. An absent visibility keeps the one the entry already stores.
 */
export function withIndicatorSettings(
  indicators: readonly SavedIndicator[],
  instanceId: string,
  settings: SettingValues,
  timeframeVisibility?: DrawingTimeframeVisibility,
): SavedIndicator[] {
  return indicators.map((indicator) => {
    if (indicator.instanceId !== instanceId) {
      return indicator;
    }
    if (timeframeVisibility === undefined) {
      return { ...indicator, settings };
    }
    return { ...withoutTimeframeVisibility(indicator), settings, ...timeframeVisibilityField(timeframeVisibility) };
  });
}

/**
 * Drops one saved indicator, leaving the other entries untouched.
 */
export function withoutIndicator(indicators: readonly SavedIndicator[], instanceId: string): SavedIndicator[] {
  return indicators.filter((indicator) => indicator.instanceId !== instanceId);
}

/** The entry without its `hidden` key, so showing it again leaves no trace of the flag. */
function withoutHiddenFlag(indicator: SavedIndicator): SavedIndicator {
  const { hidden: _hidden, ...shown } = indicator;
  return shown;
}

/** The entry without its `timeframeVisibility` key, so a new visibility, or none of them, can be written. */
function withoutTimeframeVisibility(indicator: SavedIndicator): SavedIndicator {
  const { timeframeVisibility: _timeframeVisibility, ...rest } = indicator;
  return rest;
}
