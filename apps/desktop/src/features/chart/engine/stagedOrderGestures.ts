import type { TradingLabelTarget } from './labelLayout';
import { hitCircle, hitRect, STAGED_GRAB } from './stagedOrderOverlay';
import { ticketPrice } from '../../../shared/format';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';
import type { OrderTicketState } from '../../order-ticket/state/useOrderTicket';

type StagedGestureWorkspace = Pick<ChartWorkspaceState, 'stagedOrderState'>;
type StagedGestureTicket = Pick<
  OrderTicketState,
  | 'unstageOrderDraft'
  | 'toggleExit'
  | 'setEntry'
  | 'setSlOn'
  | 'setStopLoss'
  | 'setTpOn'
  | 'setTakeProfit'
  | 'setStagedDragging'
  | 'setDragSlMoney'
>;

/** Owns staged-widget gestures; writes draft fields without dispatching orders. */
export function createStagedOrderGestures(
  host: HTMLElement,
  workspace: StagedGestureWorkspace,
  ticket: StagedGestureTicket,
) {
  const { stagedOrderState } = workspace;
  const {
    unstageOrderDraft,
    toggleExit,
    setEntry,
    setSlOn,
    setStopLoss,
    setTpOn,
    setTakeProfit,
    setStagedDragging,
    setDragSlMoney,
  } = ticket;
  let drag: 'entry' | 'sl' | 'tp' | null = null;
  let stagedEntryDrag: {
    entry: number;
    stopLoss: number | null;
    takeProfit: number | null;
    canMoveExits: boolean;
    moveExits: boolean;
  } | null = null;
  // Shared grab resolver: cancel chips first (small targets), then handles,
  // then the entry line — never for market orders (the ticket price row is
  // disabled then and entry follows the quote, so the line must pan instead).
  const resolveGrab = (
    x: number,
    y: number,
  ): 'entryCancel' | 'slCancel' | 'tpCancel' | 'entry' | 'sl' | 'tp' | null => {
    const state = stagedOrderState.current;
    const bounds = state.hit.chartRect;
    const order = state.order;
    if (!order || !bounds) {
      return null;
    }
    const { hit } = state;
    if (hitCircle(hit.entryCancel, x, y)) {
      return 'entryCancel';
    }
    if (hitCircle(hit.slCancel, x, y)) {
      return 'slCancel';
    }
    if (hitCircle(hit.tpCancel, x, y)) {
      return 'tpCancel';
    }
    if (hitRect(hit.slHandle, x, y)) {
      return 'sl';
    }
    if (hitRect(hit.tpHandle, x, y)) {
      return 'tp';
    }
    // Owner: SL/TP (and, for non-market drafts, the entry) are draggable
    // across the WHOLE line width — the same rule as an order price line,
    // not just the small handle box.
    const inLine = (lineY: number | undefined) =>
      lineY !== undefined && x >= bounds.x && x <= bounds.x + bounds.width && Math.abs(y - lineY) <= STAGED_GRAB + 2;
    if (inLine(hit.slLineY)) {
      return 'sl';
    }
    if (inLine(hit.tpLineY)) {
      return 'tp';
    }
    if (order.orderKindLabel !== 'Market' && inLine(hit.entryLineY)) {
      return 'entry';
    }
    return null;
  };
  const resolveLabelGrab = (level: TradingLabelTarget['level'], x: number, y: number) => {
    const { hit, order } = stagedOrderState.current;
    const chip = { entry: hit.entryCancel, sl: hit.slCancel, tp: hit.tpCancel }[level];
    if (hitCircle(chip, x, y)) {
      return ({ entry: 'entryCancel', sl: 'slCancel', tp: 'tpCancel' } as const)[level];
    }
    return level !== 'entry' || order?.orderKindLabel !== 'Market' ? level : null;
  };
  // Consumes the event as a widget grab/click (stop + prevent = only-on-grab).
  // Returns true when a drag target was claimed.
  const applyGrab = (
    target: 'entryCancel' | 'slCancel' | 'tpCancel' | 'entry' | 'sl' | 'tp',
    event: { stopPropagation(): void; preventDefault(): void; shiftKey?: boolean },
  ): boolean => {
    event.stopPropagation();
    event.preventDefault();
    if (target === 'entryCancel') {
      unstageOrderDraft();
      return false;
    }
    if (target === 'slCancel') {
      toggleExit('sl', false);
      return false;
    }
    if (target === 'tpCancel') {
      toggleExit('tp', false);
      return false;
    }
    drag = target as 'entry' | 'sl' | 'tp';
    const stagedOrder = stagedOrderState.current.order;
    setDragSlMoney(stagedOrder?.slMoney);
    setStagedDragging(true);
    const canMoveExits =
      stagedOrder !== null && (stagedOrder.orderKindLabel === 'Limit' || stagedOrder.orderKindLabel === 'Stop Limit');
    stagedEntryDrag =
      target === 'entry' && stagedOrder
        ? {
            entry: stagedOrder.entry,
            stopLoss: stagedOrder.stopLoss,
            takeProfit: stagedOrder.takeProfit,
            canMoveExits,
            moveExits: event.shiftKey === true && canMoveExits,
          }
        : null;
    return true;
  };
  const applyDrag = (y: number, shiftKey = false) => {
    const { hit } = stagedOrderState.current;
    if (!hit.chartRect || !hit.toPrice) {
      return;
    }
    const clampedY = Math.min(Math.max(y, hit.chartRect.y), hit.chartRect.y + hit.chartRect.height);
    const price = hit.toPrice(clampedY);
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    const text = ticketPrice(price, stagedOrderState.current.digits);
    if (drag === 'entry') {
      setEntry(text);
      const current = stagedEntryDrag;
      if (current?.canMoveExits && shiftKey) {
        current.moveExits = true;
      }
      if (current?.moveExits && Number.isFinite(current.entry) && current.entry > 0) {
        const delta = price - current.entry;
        const shiftedText = (level: number | null) => {
          if (level === null) {
            return undefined;
          }
          const shifted = level + delta;
          return ticketPrice(
            Number.isFinite(shifted) && shifted > 0 ? shifted : level,
            stagedOrderState.current.digits,
          );
        };
        const stopLoss = shiftedText(current.stopLoss);
        const takeProfit = shiftedText(current.takeProfit);
        if (stopLoss !== undefined) {
          setStopLoss(stopLoss);
        }
        if (takeProfit !== undefined) {
          setTakeProfit(takeProfit);
        }
      }
    } else if (drag === 'sl') {
      setSlOn(true);
      setStopLoss(text);
    } // dragging a handle SETS the level (TV semantics)
    else {
      setTpOn(true);
      setTakeProfit(text);
    }
  };
  const reset = () => {
    if (drag !== null) {
      setStagedDragging(false);
      setDragSlMoney(undefined);
    }
    drag = null;
    stagedEntryDrag = null;
  };
  const endDrag = (event: { pointerId?: number }) => {
    if (!drag) {
      return;
    }
    reset();
    if (event.pointerId !== undefined) {
      try {
        host.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
  };
  return {
    get active() {
      return drag !== null;
    },
    resolveGrab,
    resolveLabelGrab,
    applyGrab,
    applyDrag,
    endDrag,
    reset,
  };
}
