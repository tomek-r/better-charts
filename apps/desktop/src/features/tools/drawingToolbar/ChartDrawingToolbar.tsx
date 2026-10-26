import { useState, type RefObject } from 'react';
import type { ChartDrawings } from '../../chart/engine/drawings/chartDrawings';
import {
  resolveToolInputValues,
  type ToolInputDefinition,
  type ToolInputValues,
} from '../../chart/engine/drawings/toolInputs';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import { DrawingSettingsDialog } from '../drawingSettings/DrawingSettingsDialog';
import { CHART_TOOL_PLUGINS } from '../registry';
import { DrawingToolbar } from './DrawingToolbar';
import { useDraggablePosition } from './useDraggablePosition';
import { useDrawingSelection } from './useDrawingSelection';

/** The drawing whose settings are open, with the values the dialog started from. */
interface OpenDrawingSettings {
  readonly toolId: string;
  readonly drawingId: string;
  readonly values: ToolInputValues;
}

/** A drawing's stored settings, with each definition's default filling the gaps. */
function storedInputValues(
  drawings: ChartDrawings | undefined,
  toolId: string,
  drawingId: string,
  definitions: readonly ToolInputDefinition[],
): ToolInputValues {
  const record = drawings?.exportRecords().find((entry) => entry.toolId === toolId && entry.id === drawingId);
  return resolveToolInputValues(definitions, record?.inputs);
}

/** Hands the keyboard back to the chart once the toolbar the command was pressed on is gone. */
function focusChartHost(chartHost: RefObject<HTMLDivElement | null>): void {
  chartHost.current?.focus();
}

/**
 * The toolbar of the selected drawing and the settings dialog it opens: the one place the app commands a
 * drawing. It renders nothing while nothing is selected, which is how the pointer tools get no toolbar.
 */
export function ChartDrawingToolbar() {
  const { chart, chartHost } = useChartResources();
  const selection = useDrawingSelection();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [settings, setSettings] = useState<OpenDrawingSettings | null>(null);
  const { position, gripHandlers } = useDraggablePosition(panel);
  const plugin = selection === null ? undefined : CHART_TOOL_PLUGINS.find((entry) => entry.id === selection.toolId);
  if (selection === null || plugin === undefined) {
    return null;
  }
  const definitions = plugin.inputs ?? [];
  const openSettings = () => {
    setSettings({
      toolId: selection.toolId,
      drawingId: selection.drawingId,
      values: storedInputValues(chart.current?.drawings, selection.toolId, selection.drawingId, definitions),
    });
  };
  const saveSettings = (values: ToolInputValues) => {
    if (settings !== null) {
      chart.current?.drawings.setInputs(settings.toolId, settings.drawingId, values);
    }
    setSettings(null);
  };
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
    <>
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
      {/* A selection that moved on while the dialog was open leaves nothing that dialog could edit. */}
      {settings !== null && settings.drawingId === selection.drawingId ? (
        <DrawingSettingsDialog
          label={plugin.label}
          definitions={definitions}
          initialValues={settings.values}
          onSave={saveSettings}
          onClose={() => setSettings(null)}
        />
      ) : null}
    </>
  );
}
