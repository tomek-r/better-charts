import { createContext, useContext, useMemo, type Context, type ReactNode } from 'react';
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

  return <DrawingContext.Provider value={value}>{children}</DrawingContext.Provider>;
}

export function useChartDrawing(): DrawingState {
  return useRequiredContext(DrawingContext, 'useChartDrawing');
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used inside DrawingContextProvider.`);
  }
  return value;
}
