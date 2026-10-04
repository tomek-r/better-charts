import { createContext, useContext, useMemo, type Context, type ReactNode } from 'react';
import { useChartWorkspace, type ChartWorkspaceState } from './useChartWorkspace';
import { DrawingContextProvider } from '../tools/DrawingContextProvider';

export type ChartWorkspaceResources = Pick<
  ChartWorkspaceState,
  | 'chartHost'
  | 'chart'
  | 'adapterRef'
  | 'fixedRangeProfileState'
  | 'expectedProfile'
  | 'profileGeneration'
  | 'lastRequestedRangeRef'
  | 'stagedOrderState'
  | 'positionOverlayState'
  | 'priceLinesState'
  | 'dragModifyRef'
  | 'closeActionsRef'
  | 'instrumentDigitsRef'
  | 'stagedActiveRef'
  | 'setPendingModification'
>;

const RuntimeContext = createContext<ChartWorkspaceState | null>(null);
const ResourcesContext = createContext<ChartWorkspaceResources | null>(null);

export function ChartWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useChartWorkspace();
  const resources = useMemo<ChartWorkspaceResources>(
    () => ({
      chartHost: workspace.chartHost,
      chart: workspace.chart,
      adapterRef: workspace.adapterRef,
      fixedRangeProfileState: workspace.fixedRangeProfileState,
      expectedProfile: workspace.expectedProfile,
      profileGeneration: workspace.profileGeneration,
      lastRequestedRangeRef: workspace.lastRequestedRangeRef,
      stagedOrderState: workspace.stagedOrderState,
      positionOverlayState: workspace.positionOverlayState,
      priceLinesState: workspace.priceLinesState,
      dragModifyRef: workspace.dragModifyRef,
      closeActionsRef: workspace.closeActionsRef,
      instrumentDigitsRef: workspace.instrumentDigitsRef,
      stagedActiveRef: workspace.stagedActiveRef,
      setPendingModification: workspace.setPendingModification,
    }),
    [
      workspace.chartHost,
      workspace.chart,
      workspace.adapterRef,
      workspace.fixedRangeProfileState,
      workspace.expectedProfile,
      workspace.profileGeneration,
      workspace.lastRequestedRangeRef,
      workspace.stagedOrderState,
      workspace.positionOverlayState,
      workspace.priceLinesState,
      workspace.dragModifyRef,
      workspace.closeActionsRef,
      workspace.instrumentDigitsRef,
      workspace.stagedActiveRef,
      workspace.setPendingModification,
    ],
  );

  return (
    <RuntimeContext.Provider value={workspace}>
      <ResourcesContext.Provider value={resources}>
        <DrawingContextProvider drawingTool={workspace.drawingTool} setDrawingTool={workspace.setDrawingTool}>
          {children}
        </DrawingContextProvider>
      </ResourcesContext.Provider>
    </RuntimeContext.Provider>
  );
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used inside ChartWorkspaceProvider.`);
  }
  return value;
}

/** Full mutable workspace state for lifecycle and integration components only. */
export function useChartWorkspaceRuntime(): ChartWorkspaceState {
  return useRequiredContext(RuntimeContext, 'useChartWorkspaceRuntime');
}

/** Stable chart refs shared with bridge, ticket, and execution domains. */
export function useChartResources(): ChartWorkspaceResources {
  return useRequiredContext(ResourcesContext, 'useChartResources');
}
