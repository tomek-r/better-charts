import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ticketPrice } from '../../../shared/format';
import { clampStopLoss } from '../../chart/engine/stagedOrderGestures';
import type { StopLossBand } from '../domain/stopLossBand';
import { useOrderTicketStores } from '../state/orderTicketContext';

/**
 * Keeps a risk-sized draft's stop inside the allowed band: a stop that is too close, on the wrong
 * side of the entry or beyond the maximum moves to the nearest band edge. The band is the single
 * source of truth (deriveStopLossBand + clampStopLoss). It stays out of the user's way while the
 * stop is dragged or typed (snap happens on commit/blur) and does nothing for a stop already
 * inside the band, so quote ticks do not rewrite it.
 */
export function useOrderTicketStopLossSnap(slBand: StopLossBand | undefined, digits: number | undefined): void {
  const stores = useOrderTicketStores();
  const setters = stores.setters.draft;
  const { stopLoss, slOn, riskSide, ticketStage, stagedDragging, stopLossEditing } = useStore(
    stores.draft,
    useShallow((state) => ({
      stopLoss: state.stopLoss,
      slOn: state.slOn,
      riskSide: state.riskSide,
      ticketStage: state.ticketStage,
      stagedDragging: state.stagedDragging,
      stopLossEditing: state.stopLossEditing,
    })),
  );
  useEffect(() => {
    if (!slOn) {
      // A disabled input emits no blur, so release the editing hold here.
      if (stopLossEditing) {
        setters.setStopLossEditing(false);
      }
      return;
    }
    if (!slBand || digits === undefined || riskSide === '' || ticketStage !== 'edit' || stagedDragging) {
      return;
    }
    if (stopLossEditing) {
      return;
    }
    const level = Number(stopLoss);
    if (stopLoss.trim() === '' || !Number.isFinite(level) || level <= 0) {
      return;
    }
    const held = clampStopLoss(level, riskSide, slBand);
    if (held.edge !== null) {
      setters.setStopLoss(ticketPrice(held.price, digits));
    }
  }, [slBand, digits, slOn, stopLoss, riskSide, ticketStage, stagedDragging, stopLossEditing, setters]);
}
