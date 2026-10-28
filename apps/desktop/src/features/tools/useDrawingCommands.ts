import { useMemo } from 'react';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

/** The commands one drawing takes, bound to it. Each does nothing while no chart is mounted. */
export interface DrawingCommands {
  readonly select: () => void;
  readonly setLocked: (locked: boolean) => void;
  readonly setVisible: (visible: boolean) => void;
  /** Removes the drawing, even when it is locked; false when it removed nothing. */
  readonly remove: () => boolean;
}

/** Commands for one drawing of the chart, for the floating toolbar and the object tree rows alike. */
export function useDrawingCommands(toolId: string, drawingId: string): DrawingCommands {
  const { chart } = useChartResources();
  return useMemo(
    () => ({
      select: () => {
        chart.current?.drawings.select(toolId, drawingId);
      },
      setLocked: (locked) => {
        chart.current?.drawings.setLocked(toolId, drawingId, locked);
      },
      setVisible: (visible) => {
        chart.current?.drawings.setVisible(toolId, drawingId, visible);
      },
      remove: () => chart.current?.drawings.delete(toolId, drawingId) ?? false,
    }),
    [chart, toolId, drawingId],
  );
}
