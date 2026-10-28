import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { ChartDrawings } from '../../chart/engine/drawings/chartDrawings';
import type { ChartDrawingPoint, ChartDrawingSelection } from '../../chart/engine/drawings/drawingRecord';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../../chart/engine/drawings/timeframeVisibility';
import type { ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import { resolveToolSettingValues, type ToolSettingsSchema } from '../../chart/engine/drawings/toolSettings';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import { useRequiredContext } from '../../../shared/providers/useRequiredContext';
import { useDrawingSelection } from '../drawingToolbar/useDrawingSelection';
import { CHART_TOOL_PLUGINS } from '../registry';
import { DrawingSettingsDialog, type DrawingSettingsDialogProps } from './DrawingSettingsDialog';

/** The drawing whose settings are open, with the values the dialog started from. */
interface OpenDrawingSettings {
  readonly toolId: string;
  readonly drawingId: string;
  readonly values: ToolInputValues;
  readonly points: readonly ChartDrawingPoint[];
  readonly timeframeVisibility: DrawingTimeframeVisibility;
}

/** What the app shares about drawing settings: the one command that opens them. */
interface DrawingSettingsContextValue {
  readonly openDrawingSettings: (toolId: string, drawingId: string) => void;
}

const DrawingSettingsContext = createContext<DrawingSettingsContextValue | null>(null);

/** What a drawing stores that the dialog edits: settings with each default filling the gaps, anchors and timeframes. */
function storedDrawingState(
  drawings: ChartDrawings | undefined,
  toolId: string,
  drawingId: string,
  settings: ToolSettingsSchema,
): Pick<OpenDrawingSettings, 'values' | 'points' | 'timeframeVisibility'> {
  const record = drawings?.exportRecords().find((entry) => entry.toolId === toolId && entry.id === drawingId);
  return {
    values: resolveToolSettingValues(settings, record?.inputs),
    points: record?.points ?? [],
    timeframeVisibility: record?.timeframeVisibility ?? DEFAULT_TIMEFRAME_VISIBILITY,
  };
}

type ChartResourcesRef = ReturnType<typeof useChartResources>['chart'];

/** The drawings of the mounted chart, read at call time rather than during render. */
function drawingsOf(chart: ChartResourcesRef): ChartDrawings | undefined {
  return chart.current?.drawings;
}

/**
 * Opens the settings of one drawing, from the floating toolbar or from an object tree row alike. The
 * answers function keeps its identity while the chart does, so the rows that hold it do not re-render
 * when a dialog opens or closes.
 */
export function useOpenDrawingSettings(): (toolId: string, drawingId: string) => void {
  const { openDrawingSettings } = useRequiredContext(
    DrawingSettingsContext,
    'useOpenDrawingSettings must be used within DrawingSettingsProvider.',
  );
  return openDrawingSettings;
}

interface OpenDrawingSettingsDialogProps {
  readonly target: OpenDrawingSettings | null;
  readonly selection: ChartDrawingSelection | null;
  readonly onSave: DrawingSettingsDialogProps['onSave'];
  readonly onClose: () => void;
}

/** The dialog of the open target, for as long as its drawing stays the selected one. */
function OpenDrawingSettingsDialog({ target, selection, onSave, onClose }: OpenDrawingSettingsDialogProps) {
  if (target === null) {
    return null;
  }
  const plugin = CHART_TOOL_PLUGINS.find((entry) => entry.id === target.toolId);
  if (plugin === undefined) {
    return null;
  }
  // A selection that moved on while the dialog was open leaves nothing that dialog could edit.
  if (target.drawingId !== selection?.drawingId) {
    return null;
  }
  return (
    <DrawingSettingsDialog
      label={plugin.label}
      settings={plugin}
      initialValues={target.values}
      initialPoints={target.points}
      initialTimeframeVisibility={target.timeframeVisibility}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

export interface DrawingSettingsProviderProps {
  readonly children: ReactNode;
}

/**
 * Holds the drawing whose settings are open, and renders that one dialog. It sits above the chart and
 * the object tree, so both open the same dialog instead of keeping a copy each.
 */
export function DrawingSettingsProvider({ children }: DrawingSettingsProviderProps) {
  const { chart } = useChartResources();
  const selection = useDrawingSelection();
  const [target, setTarget] = useState<OpenDrawingSettings | null>(null);

  const openDrawingSettings = useCallback(
    (toolId: string, drawingId: string) => {
      const drawings = drawingsOf(chart);
      const plugin = CHART_TOOL_PLUGINS.find((entry) => entry.id === toolId);
      if (plugin === undefined) {
        return;
      }
      // Opening selects the drawing too, so the dialog clears itself when another drawing is picked.
      drawings?.select(toolId, drawingId);
      const stored = storedDrawingState(drawings, toolId, drawingId, plugin);
      setTarget({ toolId, drawingId, ...stored });
    },
    [chart],
  );

  const contextValue = useMemo(() => ({ openDrawingSettings }), [openDrawingSettings]);

  const saveSettings: DrawingSettingsDialogProps['onSave'] = (values, points, timeframeVisibility) => {
    const drawings = chart.current?.drawings;
    if (target !== null && drawings !== undefined) {
      // Anchors go first and only when edited: a refusal leaves the dialog open with nothing applied.
      if (points !== undefined && !drawings.setPoints(target.toolId, target.drawingId, points)) {
        return false;
      }
      drawings.setInputs(target.toolId, target.drawingId, values);
      if (timeframeVisibility !== undefined) {
        drawings.setTimeframeVisibility(target.toolId, target.drawingId, timeframeVisibility);
      }
    }
    setTarget(null);
    return true;
  };

  const closeSettings = () => {
    setTarget(null);
  };

  return (
    <DrawingSettingsContext value={contextValue}>
      {children}
      <OpenDrawingSettingsDialog target={target} selection={selection} onSave={saveSettings} onClose={closeSettings} />
    </DrawingSettingsContext>
  );
}
