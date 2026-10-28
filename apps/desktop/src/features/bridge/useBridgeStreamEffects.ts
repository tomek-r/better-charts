// Keeps portfolio overlays synchronized with the current bridge snapshot.
import { useEffect } from 'react';
import { accountMoneyBasis } from '../../shared/money';
import { quoteDigits } from '../../shared/format';
import type { ChartController } from '../chart/engine/surface/chartController';
import type { PositionOverlayState } from '../chart/engine/trading/positionOverlay';
import { syncPositionOverlay } from '../chart/engine/trading/overlayLines';
import type { BridgeSessionState } from './useBridgeSession';

type BridgeStreamState = Pick<BridgeSessionState, 'snapshot' | 'instrument' | 'account' | 'portfolio' | 'quote'>;

/** What the overlay needs to show prices and money for the symbol on screen; data of another symbol is ignored. */
function overlayDisplayInputs({
  symbol,
  instrument,
  accountCurrency,
  currencyDigits,
  quote,
}: {
  symbol: string | undefined;
  instrument: BridgeStreamState['instrument'];
  accountCurrency: string | undefined;
  currencyDigits: number | undefined;
  quote: { symbol: string | undefined; bid: string | undefined; ask: string | undefined };
}) {
  const matchingInstrument = instrument?.symbol === symbol ? instrument : undefined;
  const pnlCurrency = accountCurrency?.trim() || undefined;
  const quotePrecision =
    quote.symbol === symbol && quote.bid !== undefined && quote.ask !== undefined
      ? quoteDigits(quote.bid, quote.ask)
      : undefined;
  const estimatedMoney = accountMoneyBasis(matchingInstrument, pnlCurrency, currencyDigits);
  return { matchingInstrument, pnlCurrency, quotePrecision, estimatedMoney };
}

export function useBridgeStreamEffects(
  session: BridgeStreamState,
  {
    chart,
    positionOverlayState,
    tradingSyncTick,
    partialCloseAvailable,
    submitSwapPendingRef,
    clearStagedWidget,
  }: {
    chart: { current: ChartController | null };
    positionOverlayState: { current: PositionOverlayState };
    tradingSyncTick: number;
    partialCloseAvailable: boolean;
    submitSwapPendingRef: { current: boolean };
    clearStagedWidget: () => boolean;
  },
): void {
  const { snapshot, instrument, account, portfolio, quote } = session;
  const quoteSymbol = quote?.symbol;
  const quoteBid = quote?.bid;
  const quoteAsk = quote?.ask;
  // Sync our position and pending-order overlays for the active symbol.
  useEffect(() => {
    const instance = chart.current;
    if (!instance) {
      return;
    }
    try {
      const { matchingInstrument, pnlCurrency, quotePrecision, estimatedMoney } = overlayDisplayInputs({
        symbol: snapshot.symbol,
        instrument,
        accountCurrency: account?.currency,
        currencyDigits: account?.currencyDigits,
        quote: { symbol: quoteSymbol, bid: quoteBid, ask: quoteAsk },
      });
      const changed = syncPositionOverlay(
        positionOverlayState.current,
        portfolio,
        snapshot.symbol,
        matchingInstrument?.digits ?? quotePrecision ?? positionOverlayState.current.digits,
        estimatedMoney,
        pnlCurrency,
        account?.currencyDigits,
        partialCloseAvailable,
      );
      const swapPending = submitSwapPendingRef.current;
      if (swapPending) {
        submitSwapPendingRef.current = false;
      }
      // The fill landed: swap the frozen staged rows for the live rows in ONE
      // repaint (clearStagedWidget repaints when the widget was painted).
      const stagedWidgetRepainted = swapPending && clearStagedWidget();
      if (changed && !stagedWidgetRepainted) {
        instance.refreshOverlays();
      }
    } catch {
      // Keep the bridge stream alive if an overlay update cannot be applied.
    }
  }, [
    chart,
    positionOverlayState,
    submitSwapPendingRef,
    clearStagedWidget,
    portfolio,
    instrument,
    snapshot.symbol,
    tradingSyncTick,
    partialCloseAvailable,
    account?.currency,
    account?.currencyDigits,
    quoteSymbol,
    quoteBid,
    quoteAsk,
  ]);
}
