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
import type { OrderTicketExitsProps } from './orderTicketEditorTypes';

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
    volumeManual,
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
      volumeManual: state.volumeManual,
      draftVersion: state.slOn && state.tpOn ? state.draftVersion : 0,
      stagedOnChart: state.stagedOnChart,
      tpUnit: state.tpUnit,
      slUnit: state.slUnit,
    })),
  );
  const { riskPreview, riskProjection, riskError } = useStore(
    stores.broker,
    useShallow((state) => ({
      riskPreview: slOn && tpOn ? state.riskPreview : undefined,
      riskProjection: slOn && tpOn ? state.riskProjection : undefined,
      riskError: state.riskError,
    })),
  );
  const quote = useBridgeQuoteSelector((value) => (stagedOnChart && orderKind === 'market' ? value : undefined));
  const exitsOpen = useStore(stores.editor, (state) => state.exitsOpen);
  const effectiveVolume = orderVolume.trim();
  const account = currency === undefined ? undefined : { currency, currencyDigits };
  const display =
    slOn && tpOn
      ? deriveStagedOrderDisplay({
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
          volumeManual,
          sizingFailed: riskError !== undefined,
          riskPreview,
          draftVersion,
          lastPreview:
            riskProjection?.draftVersion === draftVersion
              ? riskProjection
              : stores.coordination.riskPreviewDisplayRef.current,
        })
      : undefined;
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
    riskRewardLabel: display?.riskRewardLabel,
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
