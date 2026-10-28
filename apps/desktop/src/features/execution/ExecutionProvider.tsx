import { createContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createFieldStore, type FieldStore } from '../../shared/store/fieldStore';
import { useRequiredContext } from '../../shared/context/useRequiredContext';
import { useStableActions } from '../../shared/identity/useStableActions';
import { useExecutionCommands, type ExecutionCommandState, type ExecutionStoreState } from './useExecutionCommands';
import { useBridgeAccount } from '../bridge/bridgeSelectors';
import { useChartResources } from '../chart/ChartWorkspaceProvider';

type ExecutionActions = Pick<
  ExecutionCommandState,
  'setExecutionQueue' | 'runCloseCancel' | 'requestClosePosition' | 'requestCancelOrder' | 'requestModifyDraft'
>;
type PortfolioActions = Pick<ExecutionCommandState, 'closingTarget' | 'closeCancelStatus' | 'requestClosePosition'>;

interface ExecutionContextValue {
  store: FieldStore<ExecutionStoreState>;
  actions: ExecutionActions;
}

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const account = useBridgeAccount();
  const { chart, positionOverlayState, setPendingModification } = useChartResources();
  const [store] = useState(() =>
    createFieldStore<ExecutionStoreState>({
      executionQueue: undefined,
      closingTarget: undefined,
      closeCancelStatus: undefined,
    }),
  );
  const execution = useExecutionCommands({ account, setPendingModification, positionOverlayState, chart, store });
  const actions = useStableActions<ExecutionActions>({
    setExecutionQueue: execution.setExecutionQueue,
    runCloseCancel: execution.runCloseCancel,
    requestClosePosition: execution.requestClosePosition,
    requestCancelOrder: execution.requestCancelOrder,
    requestModifyDraft: execution.requestModifyDraft,
  });
  const contextValue = useMemo(() => ({ store, actions }), [actions, store]);

  return <ExecutionContext value={contextValue}>{children}</ExecutionContext>;
}

function useExecutionContext(errorMessage: string): ExecutionContextValue {
  return useRequiredContext(ExecutionContext, errorMessage);
}

export function useExecutionRuntime(): ExecutionCommandState {
  const { store, actions } = useExecutionContext('Execution hooks must be used inside ExecutionProvider.');
  const state = useStore(
    store,
    useShallow((current) => ({
      executionQueue: current.executionQueue,
      closingTarget: current.closingTarget,
      closeCancelStatus: current.closeCancelStatus,
    })),
  );
  return { ...state, ...actions };
}

/** Close-position status and action used by the portfolio panel. */
export function useExecutionPortfolio(): PortfolioActions {
  const { store, actions } = useExecutionContext('Portfolio execution actions must be used inside ExecutionProvider.');
  const state = useStore(
    store,
    useShallow((current) => ({
      closingTarget: current.closingTarget,
      closeCancelStatus: current.closeCancelStatus,
    })),
  );
  return { ...state, requestClosePosition: actions.requestClosePosition };
}
