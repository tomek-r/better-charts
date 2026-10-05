import { useState, type RefObject } from 'react';
import type { PendingModification } from '../../shared/bridge/types';
import { draftLevel } from '../../shared/format';

/** Builds drag/clear drafts and dispatches only through the latest execution gate. */
export function useChartModificationDrafts(
  dragModifyRef: RefObject<{ enabled: boolean; dispatch: (draft: PendingModification) => void } | undefined>,
) {
  const [pendingModification, setPendingModification] = useState<PendingModification>();
  const [tradingSyncTick, setTradingSyncTick] = useState(0);
  // §12 flows for real-position/order drags — hoisted so the SAME functions
  // serve the chart's trading events (positionModify/orderModify) and OUR
  // capture-phase line drags on the custom overlay (features/chart/engine/positionOverlay.ts).
  // Only stable setters + dragModifyRef are touched, so mount-once effects may
  // safely capture first-render copies (dragModifyRef pattern).
  const recordDraft = (draft: PendingModification) => {
    setPendingModification(draft);
    setTradingSyncTick((value) => value + 1);
  };
  const applyPositionModify = (payload: { positionId: string; stopLoss?: number; takeProfit?: number }) => {
    const stopLoss = draftLevel(payload.stopLoss);
    const takeProfit = draftLevel(payload.takeProfit);
    const levels = [stopLoss ? `SL → ${stopLoss}` : '', takeProfit ? `TP → ${takeProfit}` : '']
      .filter(Boolean)
      .join(' · ');
    const draft: PendingModification = {
      kind: 'positionModify',
      summary: `position ${payload.positionId}${levels ? ` ${levels}` : ''}`,
      targetId: String(payload.positionId),
      stopLoss,
      takeProfit,
    };
    recordDraft(draft);
    const autoDispatch = dragModifyRef.current;
    if (autoDispatch?.enabled && (stopLoss !== undefined || takeProfit !== undefined)) {
      autoDispatch.dispatch(draft);
    }
  };
  const applyOrderModify = (payload: {
    orderId: string;
    newPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    autoDispatch: boolean;
  }) => {
    const price = draftLevel(payload.newPrice);
    const stopLoss = draftLevel(payload.stopLoss);
    const takeProfit = draftLevel(payload.takeProfit);
    const levels = [stopLoss ? `SL → ${stopLoss}` : '', takeProfit ? `TP → ${takeProfit}` : '']
      .filter(Boolean)
      .join(' · ');
    const draft: PendingModification = {
      kind: 'orderModify',
      summary: `order ${payload.orderId} price → ${price ?? payload.newPrice}${levels ? ` · ${levels}` : ''}`,
      targetId: String(payload.orderId),
      price,
      stopLoss,
      takeProfit,
    };
    recordDraft(draft);
    const autoDispatch = dragModifyRef.current;
    if (payload.autoDispatch && autoDispatch?.enabled) {
      autoDispatch.dispatch(draft);
    }
  };
  // Order SL/TP drag (custom overlay): same §12 semantics as a position level
  // drag — draft + auto-dispatch through the modify gate. The modify wire
  // carries stop_loss/take_profit for pending orders (absent price = unchanged).
  const applyOrderLevelModify = (payload: { orderId: string; stopLoss?: number; takeProfit?: number }) => {
    const stopLoss = draftLevel(payload.stopLoss);
    const takeProfit = draftLevel(payload.takeProfit);
    const levels = [stopLoss ? `SL → ${stopLoss}` : '', takeProfit ? `TP → ${takeProfit}` : '']
      .filter(Boolean)
      .join(' · ');
    const draft: PendingModification = {
      kind: 'orderModify',
      summary: `order ${payload.orderId}${levels ? ` ${levels}` : ''}`,
      targetId: String(payload.orderId),
      stopLoss,
      takeProfit,
    };
    recordDraft(draft);
    const autoDispatch = dragModifyRef.current;
    if (autoDispatch?.enabled && (stopLoss !== undefined || takeProfit !== undefined)) {
      autoDispatch.dispatch(draft);
    }
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
    recordDraft(draft);
    const autoDispatch = dragModifyRef.current;
    if (autoDispatch?.enabled) {
      autoDispatch.dispatch(draft);
    }
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
