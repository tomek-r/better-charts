import { useCallback, useEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { OrderKind } from '../../../shared/bridge/types';
import { quoteDigits, ticketPrice } from '../../../shared/format';
import { orderEntryPrice } from '../domain/ticketRules';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';

export function priceToTicks(
  price: string,
  tickKnown: boolean,
  orderKind: OrderKind,
  entry: string,
  limitPrice: string,
  tickSize: number,
): string {
  if (!tickKnown) {
    return '';
  }
  const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
  const value = Number(price);
  if (!price.trim() || !Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  return String(Math.round(Math.abs(value - base) / tickSize));
}

export function useOrderTicketPricing(
  inputs: Pick<OrderTicketInputs, 'instrument' | 'quote'>,
  stores: OrderTicketStores,
) {
  const { instrument, quote } = inputs;
  const {
    orderKind,
    ticketStage,
    entry,
    priceReference,
    priceOffset,
    limitPrice,
    riskSide,
    priceMode,
    slUnit,
    tpUnit,
  } = useStore(
    stores.draft,
    useShallow((draft) => ({
      orderKind: draft.orderKind,
      ticketStage: draft.ticketStage,
      entry: draft.entry,
      priceReference: draft.priceReference,
      priceOffset: draft.priceOffset,
      limitPrice: draft.limitPrice,
      riskSide: draft.riskSide,
      priceMode: draft.priceMode,
      slUnit: draft.slUnit,
      tpUnit: draft.tpUnit,
    })),
  );
  const setters = stores.setters.draft;
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const reference = quote ? Number(quote[priceReference]) : NaN;
  const digits = instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : 2);
  const priceSwapDisabled = orderKind === 'market' || (priceMode === 'absolute' && (!quote || !tickKnown));

  useEffect(() => {
    if (orderKind === 'market' || priceMode !== 'offset' || ticketStage !== 'edit') {
      return;
    }
    const ticks = Number(priceOffset);
    const valid =
      tickKnown && reference > 0 && Number.isFinite(reference) && priceOffset.trim() !== '' && Number.isInteger(ticks);
    setters.setEntry(valid ? ticketPrice((Math.round(reference / tickSize) + ticks) * tickSize, digits) : '');
  }, [orderKind, ticketStage, priceMode, tickKnown, reference, priceOffset, tickSize, digits, setters]);

  const togglePriceMode = useEventCallback(() => {
    if (priceSwapDisabled) {
      return;
    }
    if (priceMode === 'absolute') {
      setters.setPriceOffset(String(Math.round((Number(entry) - reference) / tickSize)));
    }
    setters.setPriceMode(priceMode === 'absolute' ? 'offset' : 'absolute');
  });
  const toTicks = (price: string) => priceToTicks(price, tickKnown, orderKind, entry, limitPrice, tickSize);
  const ticksToPrice = useCallback(
    (text: string, kind: 'sl' | 'tp'): string | null => {
      if (!tickKnown) {
        return null;
      }
      const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
      const ticks = Number(text);
      if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(ticks) || ticks < 0) {
        return null;
      }
      let direction: number;
      if (kind === 'sl') {
        direction = riskSide === 'buy' ? -1 : 1;
      } else {
        direction = riskSide === 'buy' ? 1 : -1;
      }
      const price = base + direction * ticks * tickSize;
      if (!(price > 0)) {
        return null;
      }
      return String(Number(price.toFixed(instrument?.digits ?? 2)));
    },
    [tickKnown, orderKind, entry, limitPrice, riskSide, tickSize, instrument?.digits],
  );
  const applyExitTicks = useEventCallback((kind: 'sl' | 'tp', text: string) => {
    if (text.trim() === '') {
      if (kind === 'sl') {
        setters.setStopLoss('');
      } else {
        setters.setTakeProfit('');
      }
      return;
    }
    const price = ticksToPrice(text, kind);
    if (price === null) {
      return;
    }
    if (kind === 'sl') {
      setters.setStopLoss(price);
    } else {
      setters.setTakeProfit(price);
    }
  });
  const swapExitUnit = useCallback(
    (kind: 'sl' | 'tp') => {
      if (!tickKnown) {
        return;
      }
      if (kind === 'sl') {
        setters.setSlUnit(slUnit === 'ticks' ? 'price' : 'ticks');
      } else {
        setters.setTpUnit(tpUnit === 'ticks' ? 'price' : 'ticks');
      }
    },
    [tickKnown, slUnit, tpUnit, setters],
  );
  const toggleExit = useCallback(
    (kind: 'sl' | 'tp', on: boolean) => {
      if (kind === 'sl') {
        setters.setSlOn(on);
      } else {
        setters.setTpOn(on);
      }
    },
    [setters],
  );

  return { togglePriceMode, priceToTicks: toTicks, ticksToPrice, applyExitTicks, swapExitUnit, toggleExit };
}
