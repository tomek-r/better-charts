import { useEffect, useRef } from 'react';
import { useBridgeMarketSelector } from '../bridge/BridgeSessionProvider';
import { useResetTradingTicket } from './state/useResetTradingTicket';

/**
 * Resets the ticket when the chart switches to a different symbol. A timeframe
 * change or a reconnect to the same symbol keeps the symbol, so it keeps the draft.
 * The first symbol the app shows is not a change.
 */
export function SymbolChangeTicketReset() {
  const symbol = useBridgeMarketSelector((market) => market.snapshot.symbol);
  const resetTradingTicket = useResetTradingTicket();
  const previousSymbol = useRef(symbol);
  useEffect(() => {
    const changed = previousSymbol.current !== '' && previousSymbol.current !== symbol;
    previousSymbol.current = symbol;
    if (changed) {
      resetTradingTicket();
    }
  }, [symbol, resetTradingTicket]);
  return null;
}
