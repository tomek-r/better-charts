import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { priceToTicks } from '../state/useOrderTicketPricing';
import {
  useBridgeAccountSelector,
  useBridgeMarketSelector,
  useBridgeQuoteSelector,
} from '../../bridge/BridgeSessionProvider';
import { deriveStagedOrderDisplay } from '../domain/stagedOrderDisplay';
import { stopDistanceGuard } from '../domain/ticketRules';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketExitsProps, OrderTicketExtraSettingsProps } from './orderTicketEditorTypes';

export function useOrderTicketExits(): OrderTicketExitsProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const { instrument, symbol } = useBridgeMarketSelector((market) => ({
    instrument: market.instrument,
    symbol: market.snapshot.symbol,
  }));
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const {
    riskSide,
    entry,
    limitPrice,
    orderKind,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    unitsMode,
    orderVolume,
    draftVersion,
    stagedOnChart,
    tpUnit,
    slUnit,
  } = useStore(
    stores.draft,
    useShallow((state) => ({
      riskSide: state.riskSide,
      entry: state.entry,
      limitPrice: state.limitPrice,
      orderKind: state.orderKind,
      stopLoss: state.stopLoss,
      takeProfit: state.takeProfit,
      slOn: state.slOn,
      tpOn: state.tpOn,
      unitsMode: state.unitsMode,
      orderVolume: state.orderVolume,
      draftVersion: state.draftVersion,
      stagedOnChart: state.stagedOnChart,
      tpUnit: state.tpUnit,
      slUnit: state.slUnit,
    })),
  );
  const { riskPreview, riskProjection } = useStore(
    stores.broker,
    useShallow((state) => ({ riskPreview: state.riskPreview, riskProjection: state.riskProjection })),
  );
  const quote = useBridgeQuoteSelector((value) => (stagedOnChart && orderKind === 'market' ? value : undefined));
  const exitsOpen = useStore(stores.editor, (state) => state.exitsOpen);
  const effectiveVolume = orderVolume.trim();
  const account = currency === undefined ? undefined : { currency, currencyDigits };
  const display = deriveStagedOrderDisplay({
    instrument,
    account,
    snapshot: { symbol },
    riskSide,
    entry,
    limitPrice,
    orderKind,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    effectiveVolume,
    unitsMode,
    riskPreview,
    draftVersion,
    lastPreview:
      riskProjection?.draftVersion === draftVersion
        ? riskProjection
        : stores.coordination.riskPreviewDisplayRef.current,
  });
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const stopGuard = stopDistanceGuard(
    instrument,
    riskSide,
    entry,
    slOn ? stopLoss : '',
    tpOn ? takeProfit : '',
    quote,
    orderKind,
    limitPrice,
  );
  return {
    riskRewardLabel: display.riskRewardLabel,
    open: exitsOpen,
    setOpen: stores.setters.editor.setExitsOpen,
    slTooClose: stagedOnChart && Boolean(stopGuard?.slTooClose),
    tpTooClose: stagedOnChart && Boolean(stopGuard?.tpTooClose),
    tickKnown,
    tpOn,
    slOn,
    tpUnit,
    slUnit,
    tpTicksView: priceToTicks(takeProfit, tickKnown, orderKind, entry, limitPrice, tickSize),
    slTicksView: priceToTicks(stopLoss, tickKnown, orderKind, entry, limitPrice, tickSize),
    takeProfit,
    setTakeProfit: stores.setters.draft.setTakeProfit,
    stopLoss,
    setStopLoss: stores.setters.draft.setStopLoss,
    toggleExit: actions.toggleExit,
    applyExitTicks: actions.applyExitTicks,
    swapExitUnit: actions.swapExitUnit,
    side: riskSide,
    orderKind,
    entry,
    limitPrice,
    stagedOnChart,
  };
}

export function useOrderTicketExtraSettings(): OrderTicketExtraSettingsProps {
  const stores = useOrderTicketStores();
  const open = useStore(stores.editor, (state) => state.extraSettingsOpen);
  const timeInForce = useStore(stores.draft, (state) => state.timeInForce);
  return {
    open,
    setOpen: stores.setters.editor.setExtraSettingsOpen,
    timeInForce,
    setTimeInForce: stores.setters.draft.setTimeInForce,
  };
}
