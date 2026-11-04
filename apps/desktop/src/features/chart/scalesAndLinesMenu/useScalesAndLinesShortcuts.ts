import { useEffect } from 'react';
import { offersTextEditing } from '../../../shared/ui/textEditing/textEditingTarget';
import { useChartSettings } from '../chartSettings/ChartSettingsProvider';
import { withScalesValue } from '../chartSettings/chartSettings';
import { scalesAppearanceOf } from '../chartSettings/scalesAppearanceSetting';
import { drawsLogarithmicPrices, priceScaleModeOf } from '../engine/surface/chartScalesAppearance';

const INVERT_KEY_CODE = 'KeyI';
const LOGARITHMIC_KEY_CODE = 'KeyL';

/** Option with nothing else held on macOS, Alt elsewhere: one binding serves every platform the app runs on. */
function isAltOnly(event: KeyboardEvent, code: string): boolean {
  return event.code === code && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/**
 * The price scale's two shortcuts, the ones the Scales and lines menu names: Option+I (Alt+I) flips the scale
 * over and Option+L (Alt+L) switches it between even and logarithmic spacing. Both are saved settings, so they
 * are kept the way the menu's rows keep them, and the chart draws them a render later.
 */
export function useScalesAndLinesShortcuts(): void {
  const { settings, keep } = useChartSettings();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (offersTextEditing(event.target)) {
        return;
      }
      const scales = scalesAppearanceOf(settings.scales);
      if (isAltOnly(event, INVERT_KEY_CODE)) {
        event.preventDefault();
        keep(withScalesValue(settings, 'invertScale', !scales.invertScale));
        return;
      }
      if (isAltOnly(event, LOGARITHMIC_KEY_CODE)) {
        event.preventDefault();
        const mode = priceScaleModeOf(!drawsLogarithmicPrices(scales.priceScaleMode));
        keep(withScalesValue(settings, 'priceScaleMode', mode));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keep, settings]);
}
