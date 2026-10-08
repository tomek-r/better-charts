import {
  createContext,
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { createDomainStore, useDomainField, type DomainStore } from '../../shared/state/domainStore';
import { useRequiredContext } from '../../shared/state/useRequiredContext';

export interface SymbolSearchControls {
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

interface SymbolSearchState {
  searchOpen: boolean;
}

const SearchStoreContext = createContext<DomainStore<SymbolSearchState> | null>(null);

export function SymbolSearchProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createDomainStore<SymbolSearchState>({ searchOpen: false }));
  return <SearchStoreContext value={store}>{children}</SearchStoreContext>;
}

/** Header controls stay stable while dialog visibility and query state change. */
export function useSymbolSearchControls(): SymbolSearchControls {
  const store = useRequiredContext(
    SearchStoreContext,
    'useSymbolSearchControls must be used inside SymbolSearchProvider.',
  );
  const setSearchOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (action) => store.setField('searchOpen', action),
    [store],
  );
  return useMemo(() => ({ setSearchOpen }), [setSearchOpen]);
}

/** Open state for views that need to share visibility without owning search data. */
export function useSymbolSearchOpen(): boolean {
  const store = useRequiredContext(SearchStoreContext, 'useSymbolSearchOpen must be used inside SymbolSearchProvider.');
  const [searchOpen] = useDomainField(store, 'searchOpen');
  return searchOpen;
}
