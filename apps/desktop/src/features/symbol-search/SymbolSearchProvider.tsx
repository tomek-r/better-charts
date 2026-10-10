import { createContext, useMemo, useState, type ReactNode } from 'react';
import { createDomainStore, useDomainField, type DomainStore, type FieldSetters } from '../../shared/state/domainStore';
import { useRequiredContext } from '../../shared/state/useRequiredContext';

interface SymbolSearchState {
  searchOpen: boolean;
}

export type SymbolSearchControls = Pick<FieldSetters<SymbolSearchState>, 'setSearchOpen'>;

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
  return useMemo(() => ({ setSearchOpen: store.setters.setSearchOpen }), [store]);
}

/** Open state for views that need to share visibility without owning search data. */
export function useSymbolSearchOpen(): boolean {
  const store = useRequiredContext(SearchStoreContext, 'useSymbolSearchOpen must be used inside SymbolSearchProvider.');
  const [searchOpen] = useDomainField(store, 'searchOpen');
  return searchOpen;
}
