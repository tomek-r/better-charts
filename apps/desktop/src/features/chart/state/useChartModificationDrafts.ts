import { useState, type RefObject } from 'react';
import type { PendingModification } from '../../../shared/bridge/types';
import { draftLevel } from '../../../shared/format';

/** Builds drag/clear drafts and dispatches only through the latest execution gate. */
export function useChartModificationDrafts(
  dragModifyRef: RefObject<{ enabled: boolean; dispatch: (draft: PendingModification) => void } | undefined>,
) {
  const [pendingModification, setPendingModification] = useState<PendingModification>();
  const [tradingSyncTick, setTradingSyncTick] = useState(0);
  // Flows for real-position/order drags — hoisted so the SAME functions
  // serve the chart's trading events (positionModify/orderModify) and OUR
  // capture-phase line drags on the custom overlay (features/chart/engine/positionOverlay.ts).
  // Only stable setters + dragModifyRef are touched, so mount-once effects may
  // safely capture first-render copies (dragModifyRef pattern).
  const recordDraft = (draft: PendingModification) => {
    setPendingModification(draft);
    setTradingSyncTick((value) => value + 1);
  };
  /** Records the draft, then sends it only when the latest execution gate is open and `allowed`. */
  const recordAndDispatch = (draft: PendingModification, allowed: boolean) => {
    recordDraft(draft);
    const autoDispatch = dragModifyRef.current;
    if (allowed && autoDispatch?.enabled) {
      autoDispatch.dispatch(draft);
    }
  };
  /** Shared SL/TP part of a drag draft: draft levels plus the " SL → x · TP → y" summary text. */
  const levelDraft = (payload: { stopLoss?: number; takeProfit?: number }) => {
    const stopLoss = draftLevel(payload.stopLoss);
    const takeProfit = draftLevel(payload.takeProfit);
    const levels = [stopLoss ? `SL → ${stopLoss}` : '', takeProfit ? `TP → ${takeProfit}` : '']
      .filter(Boolean)
      .join(' · ');
    return { stopLoss, takeProfit, levels, hasLevel: stopLoss !== undefined || takeProfit !== undefined };
  };
  // A level-only drag (position SL/TP, or order SL/TP from the custom overlay)
  // is the same draft + auto-dispatch through the modify gate. The modify wire
  // carries stop_loss/take_profit for pending orders (absent price = unchanged).
  const applyLevelDrag = (
    kind: 'positionModify' | 'orderModify',
    id: string,
    payload: { stopLoss?: number; takeProfit?: number },
  ) => {
    const { stopLoss, takeProfit, levels, hasLevel } = levelDraft(payload);
    const draft: PendingModification = {
      kind,
      summary: `${kind === 'positionModify' ? 'position' : 'order'} ${id}${levels ? ` ${levels}` : ''}`,
      targetId: String(id),
      stopLoss,
      takeProfit,
    };
    recordAndDispatch(draft, hasLevel);
  };
  const applyPositionModify = (payload: { positionId: string; stopLoss?: number; takeProfit?: number }) => {
    applyLevelDrag('positionModify', payload.positionId, payload);
  };
  const applyOrderModify = (payload: {
    orderId: string;
    newPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    autoDispatch: boolean;
  }) => {
    const price = draftLevel(payload.newPrice);
    const { stopLoss, takeProfit, levels } = levelDraft(payload);
    const draft: PendingModification = {
      kind: 'orderModify',
      summary: `order ${payload.orderId} price → ${price ?? payload.newPrice}${levels ? ` · ${levels}` : ''}`,
      targetId: String(payload.orderId),
      price,
      stopLoss,
      takeProfit,
    };
    recordAndDispatch(draft, payload.autoDispatch);
  };
  const applyOrderLevelModify = (payload: { orderId: string; stopLoss?: number; takeProfit?: number }) => {
    applyLevelDrag('orderModify', payload.orderId, payload);
  };
  // ✕ on a live SL/TP row: REMOVE that level — modify_order with the "0"
  // sentinel (MT5 clears a stop at price 0; `null` would mean "unchanged").
  const applyLevelClear = (level: 'sl' | 'tp', targetKey: string) => {
    const isOrder = targetKey.startsWith('order:');
    const targetId = isOrder ? targetKey.slice('order:'.length) : targetKey;
    const draft: PendingModification = {
      kind: isOrder ? 'orderModify' : 'positionModify',
      summary: `${isOrder ? 'order' : 'position'} ${targetId} ${level === 'sl' ? 'SL' : 'TP'} removed`,
      targetId,
      ...(level === 'sl' ? { stopLoss: '0' } : { takeProfit: '0' }),
    };
    recordAndDispatch(draft, true);
  };
  return {
    pendingModification,
    setPendingModification,
    tradingSyncTick,
    recordDraft,
    applyPositionModify,
    applyOrderModify,
    applyOrderLevelModify,
    applyLevelClear,
  };
}
