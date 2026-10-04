import type { Dispatch, SetStateAction } from 'react';
import type { BrokerSymbol } from '../../shared/bridge/types';

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
            if (event.key === 'Enter' && searchResults[0]) {
              void chooseSymbol(searchResults[0]);
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
        {searchError && (
          <p className="error-text" role="alert">
            {searchError}
          </p>
        )}
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
                <div className="search-result-row" key={`favorite-${item.symbol}`}>
                  <button onClick={() => void chooseSymbol(item)}>
                    <strong>{item.symbol}</strong>
                    <span>{item.description}</span>
                  </button>
                  <button
                    className="favorite-toggle"
                    aria-label={`Remove ${item.symbol} from favorites`}
                    onClick={() => toggleFavorite(item)}
                  >
                    ★
                  </button>
                </div>
              ))}
              <div className="search-section-label">Recent</div>
              {recent
                .filter((item) => !favorites.some((favorite) => favorite.symbol === item.symbol))
                .map((item) => (
                  <div className="search-result-row" key={`recent-${item.symbol}`}>
                    <button onClick={() => void chooseSymbol(item)}>
                      <strong>{item.symbol}</strong>
                      <span>{item.description}</span>
                    </button>
                    <button
                      className="favorite-toggle"
                      aria-label={`Add ${item.symbol} to favorites`}
                      onClick={() => toggleFavorite(item)}
                    >
                      ☆
                    </button>
                  </div>
                ))}
            </>
          ) : (
            searchResults.map((item) => (
              <div className="search-result-row" key={item.symbol}>
                <button onClick={() => void chooseSymbol(item)}>
                  <strong>{item.symbol}</strong>
                  <span>{item.description}</span>
                </button>
                <button
                  className="favorite-toggle"
                  aria-label={`${favorites.some((entry) => entry.symbol === item.symbol) ? 'Remove' : 'Add'} ${item.symbol} ${favorites.some((entry) => entry.symbol === item.symbol) ? 'from' : 'to'} favorites`}
                  onClick={() => toggleFavorite(item)}
                >
                  {favorites.some((entry) => entry.symbol === item.symbol) ? '★' : '☆'}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
