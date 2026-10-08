// Keeps portfolio overlays synchronized with the current bridge snapshot.
import { useEffect } from 'react';
import { accountMoneyBasis } from '../../../shared/money';
import { quoteDigits } from '../../../shared/format';
import type { ChartController } from '../../chart/engine/chartController';
import type { PositionOverlayState } from '../../chart/engine/positionOverlay';
import type { OrderTicketState } from '../../order-ticket/state/useOrderTicket';
import { syncPositionOverlay } from '../../chart/engine/overlayLines';
import type { BridgeSessionState } from '../useBridgeSession';

export function useBridgeStreamEffects(
  session: BridgeSessionState,
  {
    chart,
    positionOverlayState,
    tradingSyncTick,
    submitSwapPendingRef,
    clearStagedWidget,
  }: {
    chart: { current: ChartController | null };
    positionOverlayState: { current: PositionOverlayState };
    tradingSyncTick: number;
    submitSwapPendingRef: { current: boolean };
    clearStagedWidget: OrderTicketState['clearStagedWidget'];
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
      const matchingInstrument = instrument?.symbol === snapshot.symbol ? instrument : undefined;
      const pnlCurrency = account?.currency.trim() || undefined;
      const quotePrecision =
        quoteSymbol === snapshot.symbol && quoteBid !== undefined && quoteAsk !== undefined
          ? quoteDigits(quoteBid, quoteAsk)
          : undefined;
      const estimatedMoney = accountMoneyBasis(matchingInstrument, pnlCurrency, account?.currencyDigits);
      const changed = syncPositionOverlay(
        positionOverlayState.current,
        portfolio,
        snapshot.symbol,
        matchingInstrument?.digits ?? quotePrecision ?? positionOverlayState.current.digits,
        estimatedMoney,
        pnlCurrency,
        account?.currencyDigits,
      );
      // Repaint so the ui-layer overlay re-renders (the sync previously piggy-backed on setPositions' requestRender).
      if (submitSwapPendingRef.current) {
        // The fill landed: swap the frozen staged rows for the live rows in ONE
        // repaint (clearStagedWidget repaints when the widget was painted).
        submitSwapPendingRef.current = false;
        const had = clearStagedWidget();
        if (!had && changed) {
          instance.refreshOverlays();
        }
      } else if (changed) {
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
    account?.currency,
    account?.currencyDigits,
    quoteSymbol,
    quoteBid,
    quoteAsk,
  ]);
}
