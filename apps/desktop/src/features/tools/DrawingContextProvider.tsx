import { createContext, useMemo, type ReactNode } from 'react';
import { useRequiredContext } from '../../shared/state/useRequiredContext';
import type { DrawingTool } from './toolTypes';

export interface DrawingState {
  drawingTool: DrawingTool;
  setDrawingTool: (tool: DrawingTool) => void;
}

const DrawingContext = createContext<DrawingState | null>(null);

/**
 * Drawing toolbar state and setter, isolated from the chart's other state.
 *
 * The chart workspace owns the state and injects it here, so the toolbar and
 * its consumers re-render only when the armed tool changes — not on every
 * chart tick that updates the workspace.
 */
export function DrawingContextProvider({
  drawingTool,
  setDrawingTool,
  children,
}: DrawingState & { children: ReactNode }) {
  const value = useMemo<DrawingState>(() => ({ drawingTool, setDrawingTool }), [drawingTool, setDrawingTool]);

  return <DrawingContext value={value}>{children}</DrawingContext>;
}

export function useChartDrawing(): DrawingState {
  return useRequiredContext(DrawingContext, 'useChartDrawing must be used inside DrawingContextProvider.');
}
