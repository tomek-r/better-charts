import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SymbolSearchResult } from '../../../shared/bridge/types';

/** Results one lookup asks for; the broker matches the query, so one page covers the name. */
const LOOKUP_LIMIT = 20;

/** Longest an unanswered lookup may hold a start; past it the symbol counts as not listed. */
const LOOKUP_TIMEOUT_MS = 2000;

/**
 * True when the broker's symbol list holds `symbol`. `search_symbols` answers on
 * the `symbol-search-result` event, so the listener is ready before the request;
 * a failed or unanswered search counts as not listed.
 */
export async function brokerListsSymbol(symbol: string): Promise<boolean> {
  let settled = false;
  let stopListening: (() => void) | undefined;
  let answer: (listed: boolean) => void = () => undefined;
  const lookup = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  const settle = (listed: boolean) => {
    if (!settled) {
      settled = true;
      answer(listed);
    }
  };
  const timer = setTimeout(() => settle(false), LOOKUP_TIMEOUT_MS);
  void listen<SymbolSearchResult>('symbol-search-result', (event) => {
    if (event.payload.query === symbol) {
      settle(event.payload.symbols.some((entry) => entry.symbol === symbol));
    }
  })
    .then((unlisten) => {
      // A lookup that already timed out has no use for the listener it registered late.
      if (settled) {
        unlisten();
        return;
      }
      stopListening = unlisten;
      return invoke('search_symbols', { query: symbol, limit: LOOKUP_LIMIT });
    })
    .catch(() => settle(false));
  const listed = await lookup;
  clearTimeout(timer);
  stopListening?.();
  return listed;
}
