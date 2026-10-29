import { useCallback, useEffect, useState } from 'react';
import { SymbolSearchDialog } from './SymbolSearchDialog';
import { useSymbolSearch } from './useSymbolSearch';
import type { BrokerSymbol } from '../../shared/bridge/types';
import { useBridgeActions } from '../bridge/BridgeSessionProvider';
import { useBridgeConnection, useLastSymbolSelection } from '../bridge/bridgeSelectors';
import { useSymbolSearchControls, useSymbolSearchOpen } from './SymbolSearchProvider';
import { useRecentSymbols, useSymbolListPersistence } from './useSymbolLists';
import { useSymbolSearchHotkeys } from './useSymbolSearchHotkeys';
import { useSymbolSearchResults } from './useSymbolSearchResults';

export function SymbolSearchView() {
  const searchOpen = useSymbolSearchOpen();
  const { setSearchOpen } = useSymbolSearchControls();
  const [searchClosing, setSearchClosing] = useState(false);
  const finishClose = useCallback(() => {
    setSearchOpen(false);
    setSearchClosing(false);
  }, [setSearchOpen]);
  // Fade the panel out like the settings modal, then unmount: the dialog reports the end of its
  // backdrop animation, so the CSS alone decides how long the fade lasts. Escape reaches this even
  // with the dialog unmounted, so a closed search has nothing to fade.
  const requestClose = useCallback(() => {
    if (!searchOpen || searchClosing) {
      return;
    }
    setSearchClosing(true);
  }, [searchOpen, searchClosing]);
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

  useSymbolSearchResults({
    searchOpen,
    searchQuery,
    searchQueryRef,
    setSearchResults,
    setSearchSource,
    setSearchLoading,
    setSearchError,
  });
  useSymbolListPersistence(favorites, recent);
  useRecentSymbols(lastSymbolSelection, setRecent);

  useEffect(() => {
    if (status.state !== 'connected') {
      setSearchLoading(false);
    }
  }, [status.state, setSearchLoading]);

  useSymbolSearchHotkeys(requestClose, setSearchOpen);

  const chooseConnectedSymbol = async (item: BrokerSymbol) => {
    if (status.state !== 'connected') {
      return;
    }
    setSearchLoading(false);
    requestClose();
    setSearchQuery('');
    setSearchResults([]);
    await chooseSymbol(item);
  };

  if (!searchOpen) {
    return null;
  }

  return (
    <SymbolSearchDialog
      closing={searchClosing}
      onClose={requestClose}
      onExited={finishClose}
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
