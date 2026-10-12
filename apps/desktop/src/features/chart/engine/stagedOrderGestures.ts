import type { TradingLabelTarget } from './labelLayout';
import { hitCircle, hitRect, STAGED_GRAB, type StagedSlBand } from './stagedOrderOverlay';
import type { RiskSide } from '../../../shared/bridge/types';
import { ticketPrice } from '../../../shared/format';
import type { OrderTicketStores } from '../../order-ticket/state/orderTicketStores';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';

type StagedGestureWorkspace = Pick<ChartWorkspaceState, 'stagedOrderState'> &
  Partial<Pick<ChartWorkspaceState, 'chart'>>;

/** Holds a dragged SL inside the allowed band; `edge` names the edge that caught it. */
export function clampStopLoss(
  price: number,
  side: RiskSide,
  band: StagedSlBand | undefined,
): { price: number; edge: 'near' | 'far' | null } {
  if (!band || band.empty) {
    return { price, edge: null };
  }
  // BUY stops sit below the entry: far = lowest allowed, near = highest allowed.
  const [lowest, highest] = side === 'buy' ? [band.farPrice, band.nearPrice] : [band.nearPrice, band.farPrice];
  if (price < lowest) {
    return { price: lowest, edge: side === 'buy' ? 'far' : 'near' };
  }
  if (price > highest) {
    return { price: highest, edge: side === 'buy' ? 'near' : 'far' };
  }
  return { price, edge: null };
}
export type StagedOrderGestureTicket = Pick<
  OrderTicketStores['setters']['draft'],
  'setEntry' | 'setSlOn' | 'setStopLoss' | 'setTpOn' | 'setTakeProfit' | 'setStagedDragging' | 'setDragSlMoney'
> & {
  unstageOrderDraft: () => void;
  toggleExit: (kind: 'sl' | 'tp', on: boolean) => void;
};

/** Owns staged-widget gestures; writes draft fields without dispatching orders. */
export function createStagedOrderGestures(
  host: HTMLElement,
  workspace: StagedGestureWorkspace,
  ticket: StagedOrderGestureTicket,
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
  // Alt disables the SL band clamp (today's free drag). Returns the hint to show, if any.
  const setClampHint = (hint: string | undefined) => {
    if (stagedOrderState.current.slClampHint !== hint) {
      stagedOrderState.current.slClampHint = hint;
      workspace.chart?.current?.refreshOverlays();
    }
  };
  const applyDrag = (y: number, shiftKey = false, altKey = false) => {
    const { hit } = stagedOrderState.current;
    if (!hit.chartRect || !hit.toPrice) {
      return;
    }
    const clampedY = Math.min(Math.max(y, hit.chartRect.y), hit.chartRect.y + hit.chartRect.height);
    const price = hit.toPrice(clampedY);
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }
    const digits = stagedOrderState.current.digits;
    const text = ticketPrice(price, digits);
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
        // A Limit entry carries its SL band along, so the shifted SL keeps its
        // distance. A Stop Limit sizes from its fixed limit price: keep the shifted SL inside that band.
        const order = stagedOrderState.current.order;
        let stopLoss = shiftedText(current.stopLoss);
        if (stopLoss !== undefined && order?.orderKindLabel === 'Stop Limit' && !altKey) {
          stopLoss = ticketPrice(clampStopLoss(Number(stopLoss), order.side, order.slBand).price, digits);
        }
        const takeProfit = shiftedText(current.takeProfit);
        if (stopLoss !== undefined) {
          setStopLoss(stopLoss);
        }
        if (takeProfit !== undefined) {
          setTakeProfit(takeProfit);
        }
      }
    } else if (drag === 'sl') {
      const order = stagedOrderState.current.order;
      const band = altKey ? undefined : order?.slBand;
      const held = order ? clampStopLoss(price, order.side, band) : { price, edge: null };
      let hint: string | undefined;
      if (held.edge && band) {
        hint = held.edge === 'far' ? band.farHint : band.nearHint;
      } else if (band?.empty) {
        hint = band.emptyHint;
      }
      setClampHint(hint);
      setSlOn(true);
      setStopLoss(held.edge ? ticketPrice(held.price, digits) : text);
    } // dragging a handle SETS the level (TV semantics)
    else {
      setTpOn(true);
      setTakeProfit(text);
    }
  };
  const reset = () => {
    setClampHint(undefined);
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
