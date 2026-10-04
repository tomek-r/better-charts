import { useCallback, useRef, useState } from 'react';
import type { BrokerSymbol } from '../../shared/bridge/types';
import { favoritesKey, recentKey, loadSymbols } from './symbolStorage';

export function useSymbolSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BrokerSymbol[]>([]);
  const [searchSource, setSearchSource] = useState<'live' | 'cached'>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [favorites, setFavorites] = useState<BrokerSymbol[]>(() => loadSymbols(favoritesKey));
  const [recent, setRecent] = useState<BrokerSymbol[]>(() => loadSymbols(recentKey));
  const searchQueryRef = useRef('');
  const toggleFavorite = useCallback((item: BrokerSymbol) => {
    setFavorites((previous) =>
      previous.some((entry) => entry.symbol === item.symbol)
        ? previous.filter((entry) => entry.symbol !== item.symbol)
        : [item, ...previous.filter((entry) => entry.symbol !== item.symbol)].slice(0, 10),
    );
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchSource,
    setSearchSource,
    searchLoading,
    setSearchLoading,
    searchError,
    setSearchError,
    favorites,
    setFavorites,
    recent,
    setRecent,
    searchQueryRef,
    toggleFavorite,
  };
}
