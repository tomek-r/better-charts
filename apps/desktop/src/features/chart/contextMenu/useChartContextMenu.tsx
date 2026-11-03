import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { ChartAnchoredPanel } from '../../partial-close/ChartAnchoredPanel';
import { useChartResources } from '../ChartWorkspaceProvider';
import { useOpenChartSettings } from '../chartSettings/dialog/ChartSettingsDialogHost';
import { ChartContextMenu } from './ChartContextMenu';

interface FramePoint {
  x: number;
  y: number;
}

/**
 * Owns the chart's right-click menu. `onContextMenu` belongs on the chart frame; it opens the menu only for a press on
 * the chart itself, so overlays keep their own menus (the engine consumes a right-click on a position chip before
 * it reaches the frame).
 */
export function useChartContextMenu(): { onContextMenu: (event: MouseEvent<HTMLElement>) => void; menu: ReactNode } {
  const { chartHost, chart } = useChartResources();
  const openChartSettings = useOpenChartSettings();
  const [anchor, setAnchor] = useState<FramePoint>();
  const dismiss = useCallback(() => setAnchor(undefined), []);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Node) || !chartHost.current?.contains(event.target)) {
      return;
    }
    const frame = event.currentTarget.getBoundingClientRect();
    setAnchor({ x: event.clientX - frame.left, y: event.clientY - frame.top });
  };

  const resetView = () => {
    chart.current?.resetChartView();
    dismiss();
  };

  // The menu closes before the dialog opens, so the dialog takes the focus back to the chart, not to a row
  // of a menu that is no longer there.
  const openSettings = () => {
    dismiss();
    openChartSettings();
  };

  const menu = anchor && (
    <ChartAnchoredPanel x={anchor.x} y={anchor.y} onDismiss={dismiss}>
      <ChartContextMenu onResetView={resetView} onOpenSettings={openSettings} />
    </ChartAnchoredPanel>
  );
  return { onContextMenu, menu };
}
