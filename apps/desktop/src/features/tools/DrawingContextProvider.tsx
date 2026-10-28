import { createContext, useMemo, type ReactNode } from 'react';
import { useRequiredContext } from '../../shared/providers/useRequiredContext';
import type { ChartToolId } from './registry';

export interface DrawingState {
  activeChartToolId: ChartToolId;
  selectChartTool: (tool: ChartToolId) => void;
}

const DrawingContext = createContext<DrawingState | null>(null);

/**
 * Drawing toolbar state and setter, isolated from the chart's other state.
 *
 * The chart workspace owns the state and injects it here, so the toolbar and
 * its consumers re-render only when the active tool changes — not on every
 * chart tick that updates the workspace.
 */
export function DrawingContextProvider({
  activeChartToolId,
  selectChartTool,
  children,
}: DrawingState & { children: ReactNode }) {
  const value = useMemo<DrawingState>(
    () => ({ activeChartToolId, selectChartTool }),
    [activeChartToolId, selectChartTool],
  );

  return <DrawingContext value={value}>{children}</DrawingContext>;
}

export function useChartDrawing(): DrawingState {
  return useRequiredContext(DrawingContext, 'useChartDrawing must be used inside DrawingContextProvider.');
}
