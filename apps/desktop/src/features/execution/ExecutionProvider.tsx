import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useExecutionCommands, type ExecutionCommandState } from './useExecutionCommands';
import { useBridgeAccount } from '../bridge/BridgeSessionProvider';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

type PortfolioActions = Pick<ExecutionCommandState, 'closingTarget' | 'closeCancelStatus' | 'requestClosePosition'>;
const ExecutionContext = createContext<ExecutionCommandState | null>(null);
const PortfolioActionsContext = createContext<PortfolioActions | null>(null);

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const account = useBridgeAccount();
  const { chart, positionOverlayState, setPendingModification } = useChartResources();
  const execution = useExecutionCommands({ account, setPendingModification, positionOverlayState, chart });
  const portfolioActions = useMemo<PortfolioActions>(
    () => ({
      closingTarget: execution.closingTarget,
      closeCancelStatus: execution.closeCancelStatus,
      requestClosePosition: execution.requestClosePosition,
    }),
    [execution.closingTarget, execution.closeCancelStatus, execution.requestClosePosition],
  );

  return (
    <ExecutionContext.Provider value={execution}>
      <PortfolioActionsContext.Provider value={portfolioActions}>{children}</PortfolioActionsContext.Provider>
    </ExecutionContext.Provider>
  );
}

export function useExecutionRuntime(): ExecutionCommandState {
  const execution = useContext(ExecutionContext);
  if (execution === null) {
    throw new Error('Execution hooks must be used inside ExecutionProvider.');
  }
  return execution;
}

/** Close-position status and action used by the portfolio panel. */
export function useExecutionPortfolio(): PortfolioActions {
  const actions = useContext(PortfolioActionsContext);
  if (actions === null) {
    throw new Error('Portfolio execution actions must be used inside ExecutionProvider.');
  }
  return actions;
}
