import { useCallback } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import type { OrderTicketBaseState } from './useOrderTicketState';
import { orderEntryPrice } from '../domain/ticketRules';

type PricingInput = Pick<
  OrderTicketBaseState,
  | 'instrument'
  | 'orderKind'
  | 'entry'
  | 'limitPrice'
  | 'riskSide'
  | 'priceMode'
  | 'setPriceMode'
  | 'stopLoss'
  | 'setStopLoss'
  | 'takeProfit'
  | 'setTakeProfit'
  | 'slUnit'
  | 'setSlUnit'
  | 'tpUnit'
  | 'setTpUnit'
  | 'slOn'
  | 'setSlOn'
  | 'tpOn'
  | 'setTpOn'
> & { tickSize: number; tickKnown: boolean; priceSwapDisabled: boolean };

export function useOrderTicketPricing(ticket: PricingInput) {
  const {
    instrument,
    orderKind,
    entry,
    limitPrice,
    riskSide,
    tickSize,
    tickKnown,
    priceMode,
    setPriceMode,
    priceSwapDisabled,
    setStopLoss,
    setTakeProfit,
    slUnit,
    setSlUnit,
    tpUnit,
    setTpUnit,
    setSlOn,
    setTpOn,
  } = ticket;
  const togglePriceMode = useCallback(() => {
    if (priceSwapDisabled) {
      return;
    }
    setPriceMode(priceMode === 'absolute' ? 'offset' : 'absolute');
  }, [priceSwapDisabled, priceMode, setPriceMode]);
  const priceToTicks = (price: string, _kind: 'sl' | 'tp'): string => {
    if (!tickKnown) {
      return '';
    }
    const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value <= 0) {
      return '';
    }
    return String(Math.round(Math.abs(value - base) / tickSize));
  };
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
        setStopLoss('');
      } else {
        setTakeProfit('');
      }
      return;
    }
    const price = ticksToPrice(text, kind);
    if (price === null) {
      return;
    }
    if (kind === 'sl') {
      setStopLoss(price);
    } else {
      setTakeProfit(price);
    }
  });
  const swapExitUnit = useCallback(
    (kind: 'sl' | 'tp') => {
      if (!tickKnown) {
        return;
      }
      if (kind === 'sl') {
        setSlUnit(slUnit === 'ticks' ? 'price' : 'ticks');
      } else {
        setTpUnit(tpUnit === 'ticks' ? 'price' : 'ticks');
      }
    },
    [tickKnown, slUnit, tpUnit, setSlUnit, setTpUnit],
  );
  // Turning an exit off keeps its value; downstream preview and submit gates exclude it.
  const toggleExit = useCallback(
    (kind: 'sl' | 'tp', on: boolean) => {
      if (kind === 'sl') {
        setSlOn(on);
      } else {
        setTpOn(on);
      }
    },
    [setSlOn, setTpOn],
  );

  return { togglePriceMode, priceToTicks, ticksToPrice, applyExitTicks, swapExitUnit, toggleExit };
}
