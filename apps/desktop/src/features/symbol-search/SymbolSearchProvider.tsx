import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Context,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export interface SymbolSearchControls {
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

const OpenContext = createContext<boolean | null>(null);
const ControlsContext = createContext<SymbolSearchControls | null>(null);

export function SymbolSearchProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const controls = useMemo(() => ({ setSearchOpen }), [setSearchOpen]);

  return (
    <OpenContext.Provider value={searchOpen}>
      <ControlsContext.Provider value={controls}>{children}</ControlsContext.Provider>
    </OpenContext.Provider>
  );
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used inside SymbolSearchProvider.`);
  }
  return value;
}

/** Header controls stay stable while the dialog's local query state changes. */
export function useSymbolSearchControls(): SymbolSearchControls {
  return useRequiredContext(ControlsContext, 'useSymbolSearchControls');
}

/** Open state for views that need to share visibility without owning search data. */
export function useSymbolSearchOpen(): boolean {
  return useRequiredContext(OpenContext, 'useSymbolSearchOpen');
}
