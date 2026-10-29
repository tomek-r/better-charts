import { useEffect } from 'react';
import { offersTextEditing } from '../../../shared/ui/textEditing/textEditingTarget';
import { useAppPlatform } from '../../settings/AppSettingsProvider';
import { useChartResources } from '../ChartWorkspaceProvider';

const RESET_KEY_CODE = 'KeyR';

/** Option+R on macOS, Ctrl+R elsewhere (and while the platform is unknown); no other modifier may be held. */
function isResetViewShortcut(event: KeyboardEvent, macos: boolean): boolean {
  if (event.code !== RESET_KEY_CODE || event.shiftKey || event.metaKey) {
    return false;
  }
  return macos ? event.altKey && !event.ctrlKey : event.ctrlKey && !event.altKey;
}

/** Resets the chart view from the keyboard. Ctrl+R is the WebView's reload key, so a match is always consumed. */
export function useResetChartViewShortcut(): void {
  const { chart } = useChartResources();
  const macos = useAppPlatform() === 'macos';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isResetViewShortcut(event, macos) || offersTextEditing(event.target)) {
        return;
      }
      event.preventDefault();
      chart.current?.resetView();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chart, macos]);
}
