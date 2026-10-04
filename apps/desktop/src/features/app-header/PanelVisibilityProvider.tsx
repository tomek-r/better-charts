import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

interface PanelActions {
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
}

const PanelOpenContext = createContext<boolean | null>(null);
const PanelActionsContext = createContext<PanelActions | null>(null);

/**
 * Trade-panel visibility: the open flag the panel renders from and the toggle
 * in the header dispatches to. Split into state and actions so the header
 * toggle does not re-render when only the flag changes.
 */
export function PanelVisibilityProvider({ children }: { children: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelActions = useMemo(() => ({ setPanelOpen }), [setPanelOpen]);

  return (
    <PanelActionsContext.Provider value={panelActions}>
      <PanelOpenContext.Provider value={panelOpen}>{children}</PanelOpenContext.Provider>
    </PanelActionsContext.Provider>
  );
}

export function usePanelOpen(): boolean {
  const panelOpen = useContext(PanelOpenContext);
  if (panelOpen === null) {
    throw new Error('usePanelOpen must be used within PanelVisibilityProvider.');
  }
  return panelOpen;
}

export function usePanelActions(): PanelActions {
  const actions = useContext(PanelActionsContext);
  if (!actions) {
    throw new Error('usePanelActions must be used within PanelVisibilityProvider.');
  }
  return actions;
}
