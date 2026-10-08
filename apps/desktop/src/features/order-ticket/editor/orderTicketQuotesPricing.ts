import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { deriveQuotePresentation } from '../../../shared/format';
import { useBridgeMarketSelector, useBridgeQuoteSelector } from '../../bridge/BridgeSessionProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketPricingProps, OrderTicketQuoteProps } from './orderTicketEditorTypes';

export function useOrderTicketQuotes(): OrderTicketQuoteProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const pointSize = useBridgeMarketSelector((market) => market.instrument?.pointSize);
  const side = useStore(stores.draft, (state) => state.riskSide);
  const { bidText, askText, spreadText, spreadPoints } = useBridgeQuoteSelector(
    useShallow((quote) => deriveQuotePresentation(quote, pointSize)),
  );
  return { bidText, askText, spreadText, spreadPoints, side, stageFromQuote: actions.stageFromQuote };
}

export function useOrderTicketPricing(): OrderTicketPricingProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const instrument = useBridgeMarketSelector((market) => market.instrument);
  const hasQuote = useBridgeQuoteSelector((quote) => quote !== undefined);
  const { orderKind, entry, priceMode, priceOffset, priceReference, limitPrice, side } = useStore(
    stores.draft,
    useShallow((state) => ({
      orderKind: state.orderKind,
      entry: state.entry,
      priceMode: state.priceMode,
      priceOffset: state.priceOffset,
      priceReference: state.priceReference,
      limitPrice: state.limitPrice,
      side: state.riskSide,
    })),
  );
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled = orderKind === 'market' || (priceMode === 'absolute' && (!hasQuote || !tickKnown));
  let priceSwapTitle: string;
  if (priceMode === 'offset') {
    priceSwapTitle = 'Enter an absolute price';
  } else if (orderKind === 'market') {
    priceSwapTitle = 'Market orders follow the quote — no offset';
  } else if (!hasQuote) {
    priceSwapTitle = 'Offset needs a live quote';
  } else if (!tickKnown) {
    priceSwapTitle = 'Tick size unknown — offset conversion unavailable';
  } else {
    priceSwapTitle = 'Enter a price offset from the reference';
  }
  const limitPriceNum = Number(limitPrice.trim());
  const limitPriceValid =
    orderKind !== 'stop_limit' || (limitPrice.trim() !== '' && Number.isFinite(limitPriceNum) && limitPriceNum > 0);
  const limitPriceMisaligned =
    limitPriceValid &&
    orderKind === 'stop_limit' &&
    tickKnown &&
    Math.abs(limitPriceNum / tickSize - Math.round(limitPriceNum / tickSize)) > 1e-6;
  return {
    instrument,
    orderKind,
    setOrderKind: stores.setters.draft.setOrderKind,
    entry,
    setEntry: stores.setters.draft.setEntry,
    priceMode,
    priceOffset,
    setPriceOffset: stores.setters.draft.setPriceOffset,
    priceReference,
    setPriceReference: stores.setters.draft.setPriceReference,
    priceSwapDisabled,
    priceSwapTitle,
    togglePriceMode: actions.togglePriceMode,
    limitPrice,
    setLimitPrice: stores.setters.draft.setLimitPrice,
    limitPriceValid,
    limitPriceMisaligned,
    side,
    hasQuote,
  };
}
