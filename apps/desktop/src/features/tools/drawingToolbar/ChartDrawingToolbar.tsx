import { useState, type RefObject } from 'react';
import type { ChartDrawingSelection } from '../../chart/engine/drawings/drawingRecord';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import { useOpenDrawingSettings } from '../drawingSettings/DrawingSettingsProvider';
import { findChartToolPlugin } from '../registry';
import { useDrawingCommands } from '../useDrawingCommands';
import { DrawingToolbar, type DrawingToolbarProps } from './DrawingToolbar';
import { useDrawingToolbarPosition } from './useDrawingToolbarPosition';
import { useDrawingSelection } from './useDrawingSelection';

/** Hands the keyboard back to the chart once the toolbar the command was pressed on is gone. */
function focusChartHost(chartHost: RefObject<HTMLDivElement | null>): void {
  chartHost.current?.focus();
}

/** Whether the app registered the drawing's tool: only a registered tool can place a drawing. */
function isRegisteredTool(toolId: string): boolean {
  return findChartToolPlugin(toolId) !== undefined;
}

interface SelectedDrawingToolbarProps extends Pick<DrawingToolbarProps, 'position' | 'gripHandlers' | 'panelRef'> {
  readonly selection: ChartDrawingSelection;
}

/** The toolbar of one selected drawing, whose commands run through that drawing's ids. */
function SelectedDrawingToolbar({ selection, position, gripHandlers, panelRef }: SelectedDrawingToolbarProps) {
  const { chartHost } = useChartResources();
  const openDrawingSettings = useOpenDrawingSettings();
  const commands = useDrawingCommands(selection.toolId, selection.drawingId);
  const openSettings = () => openDrawingSettings(selection.toolId, selection.drawingId);
  const toggleLock = () => {
    commands.setLocked(!selection.locked);
  };
  const removeDrawing = () => {
    commands.remove();
    focusChartHost(chartHost);
  };
  const toggleVisibility = () => {
    commands.setVisible(!selection.visible);
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
      panelRef={panelRef}
      onOpenSettings={openSettings}
      onToggleLock={toggleLock}
      onToggleVisibility={toggleVisibility}
      onRemove={removeDrawing}
    />
  );
}

/**
 * The toolbar of the selected drawing: the one place the app commands a drawing. It renders nothing
 * while nothing is selected, which is how the pointer tools get no toolbar. The settings dialog its
 * settings button opens lives in DrawingSettingsProvider, which the object tree opens too. The place
 * the user dragged it to is held here, so it survives the toolbar going away between selections.
 */
export function ChartDrawingToolbar() {
  const selection = useDrawingSelection();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const { position, gripHandlers } = useDrawingToolbarPosition(panel);
  if (selection === null || !isRegisteredTool(selection.toolId)) {
    return null;
  }
  return (
    <SelectedDrawingToolbar selection={selection} position={position} gripHandlers={gripHandlers} panelRef={setPanel} />
  );
}
