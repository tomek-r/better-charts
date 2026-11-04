import { priceAt } from '../barStyle/priceSource';
import type { RenderBar } from '../bars/renderBar';
import type { SettingInputSource } from '../settings/settingInputs';

const HLCC4_CLOSE_WEIGHT = 2;
const HLCC4_DIVISOR = 4;

/**
 * The price an indicator reads from one bar for a `source` input. `hlcc4` is the
 * only source the bar helpers do not cover: it weighs the close twice against
 * the high and the low.
 */
export function sourceValue(bar: RenderBar, source: SettingInputSource): number {
  if (source === 'hlcc4') {
    return (bar.high + bar.low + HLCC4_CLOSE_WEIGHT * bar.close) / HLCC4_DIVISOR;
  }
  return priceAt(bar, source);
}
