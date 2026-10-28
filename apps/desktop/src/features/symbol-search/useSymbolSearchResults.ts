import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { BrokerSymbol, SymbolSearchResult } from '../../shared/bridge/types';

const SEARCH_RESULT_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 200;

interface SymbolSearchResultsState {
  searchOpen: boolean;
  searchQuery: string;
  searchQueryRef: RefObject<string>;
  setSearchResults: Dispatch<SetStateAction<BrokerSymbol[]>>;
  setSearchSource: Dispatch<SetStateAction<'live' | 'cached' | undefined>>;
  setSearchLoading: Dispatch<SetStateAction<boolean>>;
  setSearchError: Dispatch<SetStateAction<string | undefined>>;
}

/**
 * While the search is open: takes the backend's `symbol-search-result` events for the current query,
 * and asks the backend for the typed query after a short pause.
 */
export function useSymbolSearchResults({
  searchOpen,
  searchQuery,
  searchQueryRef,
  setSearchResults,
  setSearchSource,
  setSearchLoading,
  setSearchError,
}: SymbolSearchResultsState): void {
  useEffect(() => {
    if (!searchOpen) {
      return;
    }
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
      .catch(() => {
        if (!disposed) {
          setSearchLoading(false);
          setSearchError('Symbol search is unavailable.');
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [searchOpen, searchQueryRef, setSearchError, setSearchLoading, setSearchResults, setSearchSource]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      setSearchSource(undefined);
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchLoading(true);
    setSearchResults([]);
    setSearchSource(undefined);
    setSearchError(undefined);
    const timer = window.setTimeout(() => {
      void invoke('search_symbols', { query: searchQuery.trim(), limit: SEARCH_RESULT_LIMIT }).catch(() => {
        if (!active) {
          return;
        }
        setSearchLoading(false);
        setSearchError('Symbol search is unavailable.');
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, setSearchError, setSearchLoading, setSearchResults, setSearchSource]);
}
