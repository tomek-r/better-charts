import { useState, type RefObject } from 'react';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import { useOpenDrawingSettings } from '../drawingSettings/DrawingSettingsProvider';
import { CHART_TOOL_PLUGINS } from '../registry';
import { DrawingToolbar } from './DrawingToolbar';
import { useDraggablePosition } from './useDraggablePosition';
import { useDrawingSelection } from './useDrawingSelection';

/** Hands the keyboard back to the chart once the toolbar the command was pressed on is gone. */
function focusChartHost(chartHost: RefObject<HTMLDivElement | null>): void {
  chartHost.current?.focus();
}

/** Whether the app registered the drawing's tool: only a registered tool can place a drawing. */
function isRegisteredTool(toolId: string): boolean {
  return CHART_TOOL_PLUGINS.some((entry) => entry.id === toolId);
}

/**
 * The toolbar of the selected drawing: the one place the app commands a drawing. It renders nothing
 * while nothing is selected, which is how the pointer tools get no toolbar. The settings dialog its
 * settings button opens lives in DrawingSettingsProvider, which the object tree opens too.
 */
export function ChartDrawingToolbar() {
  const { chart, chartHost } = useChartResources();
  const selection = useDrawingSelection();
  const openDrawingSettings = useOpenDrawingSettings();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const { position, gripHandlers } = useDraggablePosition(panel);
  if (selection === null || !isRegisteredTool(selection.toolId)) {
    return null;
  }
  const openSettings = () => openDrawingSettings(selection.toolId, selection.drawingId);
  const toggleLock = () => {
    chart.current?.drawings.setSelectedLocked(!selection.locked);
  };
  const removeDrawing = () => {
    chart.current?.drawings.deleteSelected();
    focusChartHost(chartHost);
  };
  const toggleVisibility = () => {
    chart.current?.drawings.setVisible(selection.toolId, selection.drawingId, !selection.visible);
    if (selection.visible) {
      // Hiding clears the selection with it, so the toolbar goes and the chart keeps the keyboard.
      focusChartHost(chartHost);
    }
  };

  return (
    <DrawingToolbar
      position={position}
      locked={selection.locked}
      visible={selection.visible}
      gripHandlers={gripHandlers}
      panelRef={setPanel}
      onOpenSettings={openSettings}
      onToggleLock={toggleLock}
      onToggleVisibility={toggleVisibility}
      onRemove={removeDrawing}
    />
  );
}
