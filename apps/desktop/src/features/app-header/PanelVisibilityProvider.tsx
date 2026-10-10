import { createContext, useMemo, useState, type ReactNode } from 'react';
import { createDomainStore, useDomainField, type DomainStore, type FieldSetters } from '../../shared/state/domainStore';
import { useRequiredContext } from '../../shared/state/useRequiredContext';

interface PanelState {
  panelOpen: boolean;
}

type PanelStore = DomainStore<PanelState>;
type PanelActions = Pick<FieldSetters<PanelState>, 'setPanelOpen'>;

const PanelStoreContext = createContext<PanelStore | null>(null);

/**
 * Trade-panel visibility: the open flag the panel renders from and the toggle
 * in the header dispatches to. The store context remains stable as the flag
 * changes, so action-only header consumers stay idle.
 */
export function PanelVisibilityProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createDomainStore<PanelState>({ panelOpen: false }));
  return <PanelStoreContext value={store}>{children}</PanelStoreContext>;
}

export function usePanelOpen(): boolean {
  const store = useRequiredContext(PanelStoreContext, 'usePanelOpen must be used within PanelVisibilityProvider.');
  const [panelOpen] = useDomainField(store, 'panelOpen');
  return panelOpen;
}

export function usePanelActions(): PanelActions {
  const store = useRequiredContext(PanelStoreContext, 'usePanelActions must be used within PanelVisibilityProvider.');
  return useMemo(() => ({ setPanelOpen: store.setters.setPanelOpen }), [store]);
}
