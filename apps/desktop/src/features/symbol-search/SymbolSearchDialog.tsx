import { ErrorNotification } from '../../shared/ui/ErrorNotifications';
import type { Dispatch, SetStateAction } from 'react';
import type { BrokerSymbol } from '../../shared/bridge/types';

function SymbolResultRow({
  item,
  isFavorite,
  chooseSymbol,
  toggleFavorite,
}: {
  item: BrokerSymbol;
  isFavorite: boolean;
  chooseSymbol: (item: BrokerSymbol) => Promise<void>;
  toggleFavorite: (item: BrokerSymbol) => void;
}) {
  const action = `${isFavorite ? 'Remove' : 'Add'} ${item.symbol} ${isFavorite ? 'from' : 'to'} favorites`;

  return (
    <div className="search-result-row">
      <button onClick={() => void chooseSymbol(item)}>
        <strong>{item.symbol}</strong>
        <span>{item.description}</span>
      </button>
      <button className="favorite-toggle" aria-label={action} onClick={() => toggleFavorite(item)}>
        {isFavorite ? '★' : '☆'}
      </button>
    </div>
  );
}

export function SymbolSearchDialog({
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchResults,
  searchLoading,
  searchError,
  searchSource,
  favorites,
  recent,
  chooseSymbol,
  toggleFavorite,
}: {
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchResults: BrokerSymbol[];
  searchLoading: boolean;
  searchError: string | undefined;
  searchSource: 'live' | 'cached' | undefined;
  favorites: BrokerSymbol[];
  recent: BrokerSymbol[];
  chooseSymbol: (item: BrokerSymbol) => Promise<void>;
  toggleFavorite: (item: BrokerSymbol) => void;
}) {
  const favoriteSymbols = new Set(favorites.map((item) => item.symbol));
  const recentOnly = recent.filter((item) => !favoriteSymbols.has(item.symbol));
  const firstResult = searchQuery.trim() ? searchResults[0] : (favorites[0] ?? recentOnly[0]);

  return (
    <div
      className="search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setSearchOpen(false);
        }
      }}
    >
      <section className="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title">
        <div className="search-title">
          <h2 id="search-title">Search symbols</h2>
          <button onClick={() => setSearchOpen(false)} aria-label="Close search">
            ×
          </button>
        </div>
        <input
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && firstResult) {
              void chooseSymbol(firstResult);
            }
          }}
          placeholder="Search symbol — e.g. NAS100"
        />
        {searchLoading && searchResults.length === 0 && (
          <div className="search-skeleton" role="status" aria-label="Searching MT5 symbols">
            <span />
            <span />
            <span />
          </div>
        )}
        {searchError && <ErrorNotification message={searchError} />}
        {!searchLoading && searchQuery && !searchError && searchResults.length === 0 && (
          <p className="search-hint">No symbols found.</p>
        )}
        {searchSource === 'cached' && (
          <p className="search-hint">Cached results — bridge offline. List saved from MT5.</p>
        )}
        <div className="search-results">
          {!searchQuery.trim() ? (
            <>
              <div className="search-section-label">Favorites</div>
              {favorites.map((item) => (
                <SymbolResultRow
                  item={item}
                  isFavorite
                  chooseSymbol={chooseSymbol}
                  toggleFavorite={toggleFavorite}
                  key={`favorite-${item.symbol}`}
                />
              ))}
              <div className="search-section-label">Recent</div>
              {recentOnly.map((item) => (
                <SymbolResultRow
                  item={item}
                  isFavorite={false}
                  chooseSymbol={chooseSymbol}
                  toggleFavorite={toggleFavorite}
                  key={`recent-${item.symbol}`}
                />
              ))}
            </>
          ) : (
            searchResults.map((item) => (
              <SymbolResultRow
                item={item}
                isFavorite={favoriteSymbols.has(item.symbol)}
                chooseSymbol={chooseSymbol}
                toggleFavorite={toggleFavorite}
                key={item.symbol}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
