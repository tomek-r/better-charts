import { createContext, useMemo, useState, type ReactNode } from 'react';
import { createDomainStore, useDomainField, type DomainStore } from '../../shared/state/domainStore';
import { useRequiredContext } from '../../shared/state/useRequiredContext';

export type SideDrawerId = 'tradePanel' | 'objectTree';

interface SideDrawerState {
  openDrawer: SideDrawerId | null;
}

type SideDrawerStore = DomainStore<SideDrawerState>;

interface SideDrawerActions {
  toggleDrawer: (drawer: SideDrawerId) => void;
}

const SideDrawerStoreContext = createContext<SideDrawerStore | null>(null);

const MISSING_PROVIDER_MESSAGE = 'Side drawer hooks must be used within SideDrawerProvider.';

/** At most one drawer is open: switching to the other drawer replaces the open one. */
function toggledDrawer(openDrawer: SideDrawerId | null, drawer: SideDrawerId): SideDrawerId | null {
  return openDrawer === drawer ? null : drawer;
}

/**
 * Which right-side drawer is open: the flag the drawers render from and the strip
 * and header dispatch to. The store context stays stable as the flag changes, so
 * action-only consumers stay idle.
 */
export function SideDrawerProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createDomainStore<SideDrawerState>({ openDrawer: null }));
  return <SideDrawerStoreContext value={store}>{children}</SideDrawerStoreContext>;
}

export function useSideDrawerOpen(drawer: SideDrawerId): boolean {
  const store = useRequiredContext(SideDrawerStoreContext, MISSING_PROVIDER_MESSAGE);
  const [openDrawer] = useDomainField(store, 'openDrawer');
  return openDrawer === drawer;
}

export function useSideDrawerActions(): SideDrawerActions {
  const store = useRequiredContext(SideDrawerStoreContext, MISSING_PROVIDER_MESSAGE);
  return useMemo(
    () => ({
      toggleDrawer: (drawer: SideDrawerId) =>
        store.setters.setOpenDrawer((openDrawer) => toggledDrawer(openDrawer, drawer)),
    }),
    [store],
  );
}
