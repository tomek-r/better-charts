import type { IndicatorFill, IndicatorFillEdge } from '../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../chart/engine/settings/settingStyles';
import { booleanSetting, colorSetting } from './indicatorSettingValues';

/** The fill of a band is on until the user switches its Background style off in the Style tab. */
const BACKGROUND_VISIBLE = true;

/**
 * The fill between `from` and `to` in the colour of the band's own style, or no fill while that style
 * is switched off.
 */
export function backgroundFill(
  settings: SettingValues,
  styleId: string,
  defaultColor: string,
  from: IndicatorFillEdge,
  to: IndicatorFillEdge,
): IndicatorFill[] {
  if (!booleanSetting(settings, settingStyleKey(styleId, 'visible'), BACKGROUND_VISIBLE)) {
    return [];
  }
  return [{ from, to, color: colorSetting(settings, styleId, defaultColor) }];
}
