import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SymbolSearchDialog } from './SymbolSearchDialog';
import { useSymbolSearch } from './useSymbolSearch';
import type { BrokerSymbol, SymbolSearchResult } from '../../shared/bridge/types';
import { favoritesKey, recentKey, saveSymbols } from './symbolStorage';
import { useBridgeActions, useBridgeConnection, useLastSymbolSelection } from '../bridge/BridgeSessionProvider';
import { useSymbolSearchControls, useSymbolSearchOpen } from './SymbolSearchProvider';

const toolFlyoutOpen = () => document.querySelector('.tool-flyout') !== null;

export function SymbolSearchView() {
  const searchOpen = useSymbolSearchOpen();
  const { setSearchOpen } = useSymbolSearchControls();
  const search = useSymbolSearch();
  const { chooseSymbol } = useBridgeActions();
  const { status } = useBridgeConnection();
  const lastSymbolSelection = useLastSymbolSelection();
  const {
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
    recent,
    setRecent,
    searchQueryRef,
    toggleFavorite,
  } = search;

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery, searchQueryRef]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SymbolSearchResult>('symbol-search-result', (event) => {
      if (!disposed && event.payload.query === searchQueryRef.current.trim()) {
        setSearchResults(event.payload.symbols);
        setSearchSource(event.payload.source);
        setSearchLoading(false);
        setSearchError(undefined);
      }
    })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSearchLoading(false);
          setSearchError('Symbol search is unavailable.');
          console.info('Symbol search unavailable.', error);
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [searchQueryRef, setSearchError, setSearchLoading, setSearchResults, setSearchSource]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      setSearchSource(undefined);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    setSearchResults([]);
    setSearchSource(undefined);
    setSearchError(undefined);
    const timer = window.setTimeout(() => {
      void invoke('search_symbols', { query: searchQuery.trim(), limit: 20 }).catch((error) => {
        setSearchLoading(false);
        setSearchError('Symbol search is unavailable.');
        console.info('Symbol search unavailable.', error);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery, setSearchError, setSearchLoading, setSearchResults, setSearchSource]);

  useEffect(() => {
    if (searchOpen && !searchQuery.trim()) {
      const combined = [
        ...favorites,
        ...recent.filter((item) => !favorites.some((favorite) => favorite.symbol === item.symbol)),
      ];
      setSearchResults(combined);
    }
  }, [searchOpen, searchQuery, favorites, recent, setSearchResults]);

  useEffect(() => {
    saveSymbols(favoritesKey, favorites);
  }, [favorites]);

  useEffect(() => {
    saveSymbols(recentKey, recent);
  }, [recent]);

  useEffect(() => {
    if (lastSymbolSelection) {
      setRecent((previous) =>
        [lastSymbolSelection, ...previous.filter((item) => item.symbol !== lastSymbolSelection.symbol)].slice(0, 10),
      );
    }
  }, [lastSymbolSelection, setRecent]);

  useEffect(() => {
    if (status.state !== 'connected') {
      setSearchLoading(false);
    }
  }, [status.state, setSearchLoading]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[data-app-settings-dialog]')) {
        return;
      }
      if (event.key === 'Escape' && toolFlyoutOpen()) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [setSearchOpen]);

  const chooseConnectedSymbol = async (item: BrokerSymbol) => {
    if (status.state !== 'connected') {
      return;
    }
    setSearchLoading(false);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    await chooseSymbol(item);
  };

  if (!searchOpen) {
    return null;
  }

  return (
    <SymbolSearchDialog
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      searchResults={searchResults}
      searchLoading={searchLoading}
      searchError={searchError}
      searchSource={searchSource}
      favorites={favorites}
      recent={recent}
      chooseSymbol={chooseConnectedSymbol}
      toggleFavorite={toggleFavorite}
    />
  );
}
