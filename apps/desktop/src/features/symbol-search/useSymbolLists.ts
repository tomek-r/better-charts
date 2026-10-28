import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { BrokerSymbol } from '../../shared/bridge/types';
import { favoritesKey, MAX_SAVED_SYMBOLS, recentKey, saveSymbols } from './symbolStorage';

/** Writes the favorites and the recent list to local storage whenever either changes. */
export function useSymbolListPersistence(favorites: BrokerSymbol[], recent: BrokerSymbol[]): void {
  useEffect(() => {
    saveSymbols(favoritesKey, favorites);
  }, [favorites]);

  useEffect(() => {
    saveSymbols(recentKey, recent);
  }, [recent]);
}

/** Puts each symbol the chart switches to at the head of the recent list. */
export function useRecentSymbols(
  lastSymbolSelection: BrokerSymbol | undefined,
  setRecent: Dispatch<SetStateAction<BrokerSymbol[]>>,
): void {
  useEffect(() => {
    if (lastSymbolSelection) {
      setRecent((previous) =>
        [lastSymbolSelection, ...previous.filter((item) => item.symbol !== lastSymbolSelection.symbol)].slice(
          0,
          MAX_SAVED_SYMBOLS,
        ),
      );
    }
  }, [lastSymbolSelection, setRecent]);
}
