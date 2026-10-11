import { createContext, useMemo, type ReactNode } from 'react';
import { useChartWorkspace, type ChartWorkspaceState } from './state/useChartWorkspace';
import { DrawingContextProvider } from '../tools/DrawingContextProvider';
import { useRequiredContext } from '../../shared/state/useRequiredContext';

export type ChartWorkspaceResources = Pick<
  ChartWorkspaceState,
  | 'chartHost'
  | 'chart'
  | 'adapterRef'
  | 'stagedOrderState'
  | 'positionOverlayState'
  | 'priceLinesState'
  | 'dragModifyRef'
  | 'closeActionsRef'
  | 'partialCloseChipPortRef'
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
      stagedOrderState: workspace.stagedOrderState,
      positionOverlayState: workspace.positionOverlayState,
      priceLinesState: workspace.priceLinesState,
      dragModifyRef: workspace.dragModifyRef,
      closeActionsRef: workspace.closeActionsRef,
      partialCloseChipPortRef: workspace.partialCloseChipPortRef,
      instrumentDigitsRef: workspace.instrumentDigitsRef,
      stagedActiveRef: workspace.stagedActiveRef,
      setPendingModification: workspace.setPendingModification,
    }),
    [
      workspace.chartHost,
      workspace.chart,
      workspace.adapterRef,
      workspace.stagedOrderState,
      workspace.positionOverlayState,
      workspace.priceLinesState,
      workspace.dragModifyRef,
      workspace.closeActionsRef,
      workspace.partialCloseChipPortRef,
      workspace.instrumentDigitsRef,
      workspace.stagedActiveRef,
      workspace.setPendingModification,
    ],
  );

  return (
    <RuntimeContext value={workspace}>
      <ResourcesContext value={resources}>
        <DrawingContextProvider
          activeChartToolId={workspace.activeChartToolId}
          selectChartTool={workspace.selectChartTool}
        >
          {children}
        </DrawingContextProvider>
      </ResourcesContext>
    </RuntimeContext>
  );
}

/** Full mutable workspace state for lifecycle and integration components only. */
export function useChartWorkspaceRuntime(): ChartWorkspaceState {
  return useRequiredContext(RuntimeContext, 'useChartWorkspaceRuntime must be used inside ChartWorkspaceProvider.');
}

/** Stable chart refs shared with bridge, ticket, and execution domains. */
export function useChartResources(): ChartWorkspaceResources {
  return useRequiredContext(ResourcesContext, 'useChartResources must be used inside ChartWorkspaceProvider.');
}
