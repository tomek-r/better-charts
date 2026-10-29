import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useBridgeMarketSelector, useBridgeQuoteSelector } from '../../bridge/bridgeSelectors';
import { useOrderTicketActions, useOrderTicketStores } from '../draft/orderTicketContext';
import type { OrderTicketPricingProps } from '../orderTicketEditorProps';
import { isLimitPriceValid } from './orderEntryPrice';
import { isPriceSwapDisabled, tickSizeOf } from './priceTicks';

export function useOrderTicketPricingProps(): OrderTicketPricingProps {
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
  const { tickSize, tickKnown } = tickSizeOf(instrument);
  const priceSwapDisabled = isPriceSwapDisabled({ orderKind, priceMode, hasQuote, tickKnown });
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
  const limitPriceValid = isLimitPriceValid(orderKind, limitPrice);
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
