import { useEffect } from 'react';
import { useEventCallback } from '../../../shared/identity/useEventCallback';
import { createChartPointerRouter } from '../engine/trading/chartPointerRouter';
import type { StagedOrderGestureTicket } from '../engine/trading/stagedOrderGestures';
import { DEFAULT_CHART_TOOL_ID } from '../../tools/registry';
import type { ChartWorkspaceState } from '../workspace/useChartWorkspace';
import { useChartGestureDiagnostics } from './useChartGestureDiagnostics';

// Test-only hook: `import.meta.env.DEV` is a build-time constant, so production
// builds drop the diagnostics module and this stays a stable per-build hook.
const useDiagnostics: (workspace: ChartWorkspaceState) => void = import.meta.env.DEV
  ? useChartGestureDiagnostics
  : () => undefined;

export function useChartWorkspacePointerEffects(
  workspace: ChartWorkspaceState,
  ticket: StagedOrderGestureTicket,
): void {
  const {
    chartHost,
    chart,
    stagedOrderState,
    positionOverlayState,
    closeActionsRef,
    partialCloseChipPortRef,
    selectChartTool,
  } = workspace;
  const {
    unstageOrderDraft,
    toggleExit,
    setEntry,
    setSlOn,
    setStopLoss,
    setTpOn,
    setTakeProfit,
    setStagedDragging,
    setDragSlMoney,
  } = ticket;
  const applyOrderModify = useEventCallback(workspace.applyOrderModify);
  const applyOrderLevelModify = useEventCallback(workspace.applyOrderLevelModify);
  const applyPositionModify = useEventCallback(workspace.applyPositionModify);
  const applyLevelClear = useEventCallback(workspace.applyLevelClear);

  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    const router = createChartPointerRouter(host, {
      stagedOrderState,
      positionOverlayState,
      chart,
      ticket: {
        unstageOrderDraft,
        toggleExit,
        setEntry,
        setSlOn,
        setStopLoss,
        setTpOn,
        setTakeProfit,
        setStagedDragging,
        setDragSlMoney,
      },
      applyOrderModify,
      applyOrderLevelModify,
      applyPositionModify,
      applyLevelClear,
      closeActionsRef,
      partialCloseChipPortRef,
      defaultToolId: DEFAULT_CHART_TOOL_ID,
      onDefaultToolSelected: () => selectChartTool(DEFAULT_CHART_TOOL_ID),
    });
    return router.attach();
  }, [
    chartHost,
    chart,
    stagedOrderState,
    positionOverlayState,
    closeActionsRef,
    partialCloseChipPortRef,
    selectChartTool,
    unstageOrderDraft,
    toggleExit,
    setEntry,
    setSlOn,
    setStopLoss,
    setTpOn,
    setTakeProfit,
    setStagedDragging,
    setDragSlMoney,
    applyOrderModify,
    applyOrderLevelModify,
    applyPositionModify,
    applyLevelClear,
  ]);
  useDiagnostics(workspace);
}
