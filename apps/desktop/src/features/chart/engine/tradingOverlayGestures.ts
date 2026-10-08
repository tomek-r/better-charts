import type { TradingLabelHit } from './labelLayout';
import { hitCircle, hitRect, STAGED_GRAB } from './stagedOrderOverlay';
import { TRADING_GRAB, LINE_DRAG_THRESHOLD } from './positionOverlay';
import { levelMoneyText } from './overlayLines';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';

type TradingGestureWorkspace = Pick<
  ChartWorkspaceState,
  | 'positionOverlayState'
  | 'chart'
  | 'applyOrderModify'
  | 'applyOrderLevelModify'
  | 'applyPositionModify'
  | 'applyLevelClear'
  | 'closeActionsRef'
>;

/** Grab targets of OUR position/order overlay (capture-phase handlers here). */
type OverlayGrab =
  | { kind: 'posClose'; id: string }
  | { kind: 'orderCancel'; id: string }
  | { kind: 'slClear'; id: string }
  | { kind: 'tpClear'; id: string }
  | { kind: 'line'; line: 'order' | 'sl' | 'tp'; id: string };

/** Owns live overlay previews, modifications, and release-only chip actions. */
export function createTradingOverlayGestures(host: HTMLElement, workspace: TradingGestureWorkspace) {
  const {
    positionOverlayState,
    chart,
    applyOrderModify,
    applyOrderLevelModify,
    applyPositionModify,
    applyLevelClear,
    closeActionsRef,
  } = workspace;
  let lineDrag: {
    line: 'order' | 'sl' | 'tp';
    id: string;
    startY: number;
    started: boolean;
    price?: number;
    orderPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    canMoveExits?: boolean;
    moveExits?: boolean;
    preserveExits?: boolean;
  } | null = null;
  let chipPress: {
    kind: 'posClose' | 'orderCancel' | 'slClear' | 'tpClear';
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  /** Slop before a ✕ press counts as a drag (abandons the click) — staged grab slop. */
  const CHIP_CLICK_SLOP = STAGED_GRAB;
  // Custom overlay (features/chart/engine/positionOverlay.ts): ✕ chips first (small precise
  // targets), then lines in the LIBRARY's hit order — order price, position
  // SL, position TP — with its ±8px y tolerance; lines bounded to chartRect so
  // the axis strip keeps its native scale-drag (the library's axis check ran
  // before its trading hit-test too).
  const resolveOverlayGrab = (x: number, y: number): OverlayGrab | null => {
    const { hit } = positionOverlayState.current;
    const bounds = hit.chartRect;
    // Full chartRect containment (incl. y): the library hit-tested inside the
    // chart container only — toolbar/sidebar clicks must never claim a line
    // or ✕ chip, and everything outside must keep panning/scale-dragging.
    if (!bounds || x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) {
      return null;
    }
    for (const chip of hit.posCloses ?? []) {
      if (hitCircle(chip, x, y)) {
        return { kind: 'posClose', id: chip.id };
      }
    }
    for (const chip of hit.orderCancels ?? []) {
      if (hitCircle(chip, x, y)) {
        return { kind: 'orderCancel', id: chip.id };
      }
    }
    for (const chip of hit.slClears ?? []) {
      if (hitCircle(chip, x, y)) {
        return { kind: 'slClear', id: chip.id };
      }
    }
    for (const chip of hit.tpClears ?? []) {
      if (hitCircle(chip, x, y)) {
        return { kind: 'tpClear', id: chip.id };
      }
    }
    const near = (lineY: number | undefined) => lineY !== undefined && Math.abs(y - lineY) <= TRADING_GRAB;
    for (const line of hit.orderLines ?? []) {
      if (near(line.y)) {
        return { kind: 'line', line: 'order', id: line.id };
      }
    }
    for (const line of hit.slLines ?? []) {
      if (near(line.y)) {
        return { kind: 'line', line: 'sl', id: line.id };
      }
    }
    for (const line of hit.tpLines ?? []) {
      if (near(line.y)) {
        return { kind: 'line', line: 'tp', id: line.id };
      }
    }
    for (const handle of hit.slHandles ?? []) {
      if (hitRect(handle, x, y)) {
        return { kind: 'line', line: 'sl', id: handle.id };
      }
    }
    for (const handle of hit.tpHandles ?? []) {
      if (hitRect(handle, x, y)) {
        return { kind: 'line', line: 'tp', id: handle.id };
      }
    }
    return null;
  };
  const resolveLabelGrab = (row: TradingLabelHit, x: number, y: number): OverlayGrab | null => {
    const { hit } = positionOverlayState.current;
    if (row.level === 'entry') {
      if (row.id.startsWith('order:')) {
        const id = row.id.slice('order:'.length);
        const chip = hit.orderCancels?.find((item) => item.id === id);
        return hitCircle(chip, x, y) ? { kind: 'orderCancel', id } : { kind: 'line', line: 'order', id };
      }
      const chip = hit.posCloses?.find((item) => item.id === row.id);
      return hitCircle(chip, x, y) ? { kind: 'posClose', id: row.id } : null;
    }
    const chips = row.level === 'sl' ? hit.slClears : hit.tpClears;
    const chip = chips?.find((item) => item.id === row.id);
    if (hitCircle(chip, x, y)) {
      return { kind: row.level === 'sl' ? 'slClear' : 'tpClear', id: row.id };
    }
    return { kind: 'line', line: row.level, id: row.id };
  };
  // Custom-overlay line drag — library TradingDragHandler semantics: claim on
  // pointerdown, only start tracking after LINE_DRAG_THRESHOLD vertical px
  // (3px, dragThreshold), yToPrice UNCLAMPED (a drag may set a level outside
  // the visible range — the library extrapolated the same way), live preview
  // through state.drag, dispatch the same §12 flows on release.
  // Live money label for the dragged level ("-$6.63") — the same
  // levelMoneyText basis the rows carry, recomputed per move.
  const dragLevelMoney = (line: 'order' | 'sl' | 'tp', id: string, price: number): string | undefined => {
    const state = positionOverlayState.current;
    const basis = state.money;
    if (!basis || line === 'order') {
      return undefined;
    }
    const position = state.positions.find((item) => item.id === id);
    const order = state.orders.find((item) => `order:${item.id}` === id);
    const entry = position?.entry ?? order?.price;
    const side = position?.side ?? order?.side;
    let volume = NaN;
    if (position !== undefined) {
      volume = Number(position.volume);
    } else if (order !== undefined) {
      volume = Number(order.quantity);
    }
    if (entry === undefined || side === undefined || !Number.isFinite(volume) || volume <= 0) {
      return undefined;
    }
    return levelMoneyText(entry, price, volume, side, basis);
  };
  const applyLineDrag = (y: number, shiftKey = false) => {
    const current = lineDrag;
    if (!current) {
      return;
    }
    if (shiftKey && current.canMoveExits) {
      current.moveExits = true;
    }
    const { hit } = positionOverlayState.current;
    if (!hit.chartRect || !hit.toPrice) {
      return;
    }
    if (!current.started) {
      if (Math.abs(y - current.startY) < LINE_DRAG_THRESHOLD) {
        return;
      } // consume, don't track (library dragThreshold)
      current.started = true;
    }
    const price = hit.toPrice(y);
    const state = positionOverlayState.current;
    if (!Number.isFinite(price) || price <= 0) {
      current.price = undefined;
      if (state.drag !== null) {
        state.drag = null;
        chart.current?.refreshOverlays();
      }
      return;
    }
    current.price = price;
    const money = dragLevelMoney(current.line, current.id, price);
    const exitDelta = current.moveExits && current.orderPrice !== undefined ? price - current.orderPrice : 0;
    const shiftedExit = (level: number | undefined) => {
      if (level === undefined || exitDelta === 0) {
        return level;
      }
      const shifted = level + exitDelta;
      return Number.isFinite(shifted) && shifted > 0 ? shifted : level;
    };
    const previewStopLoss = current.line === 'order' ? shiftedExit(current.stopLoss) : undefined;
    const previewTakeProfit = current.line === 'order' ? shiftedExit(current.takeProfit) : undefined;
    if (
      state.drag?.kind !== current.line ||
      state.drag.id !== current.id ||
      state.drag.price !== price ||
      state.drag.money !== money ||
      state.drag.exitPreview !== (current.line === 'order') ||
      state.drag.shiftedExits !== (current.moveExits || current.preserveExits) ||
      state.drag.stopLoss !== previewStopLoss ||
      state.drag.takeProfit !== previewTakeProfit
    ) {
      state.drag = {
        kind: current.line,
        id: current.id,
        price,
        money,
        exitPreview: current.line === 'order',
        shiftedExits: current.moveExits || current.preserveExits,
        stopLoss: previewStopLoss,
        takeProfit: previewTakeProfit,
      };
      chart.current?.refreshOverlays(); // repaint: painter reads state.drag for the preview
    }
  };
  const startPointer = (overlay: OverlayGrab, x: number, y: number, shiftKey: boolean) => {
    if (overlay.kind !== 'line') {
      chipPress = { kind: overlay.kind, id: overlay.id, startX: x, startY: y, moved: false };
    } else {
      const order =
        overlay.line === 'order'
          ? positionOverlayState.current.orders.find((item) => item.id === overlay.id)
          : undefined;
      const canMoveExits = order !== undefined && (order.label === 'LIMIT' || order.label === 'STOP LIMIT');
      const existingPreview = positionOverlayState.current.drag;
      const orderPreview =
        existingPreview?.kind === 'order' && existingPreview.id === overlay.id && existingPreview.exitPreview
          ? existingPreview
          : undefined;
      const moveExits = shiftKey && canMoveExits;
      const preserveExits = orderPreview?.shiftedExits === true;
      lineDrag = {
        line: overlay.line,
        id: overlay.id,
        startY: y,
        started: false,
        price: undefined,
        orderPrice: canMoveExits ? (orderPreview?.price ?? order.price) : undefined,
        stopLoss: canMoveExits
          ? (orderPreview?.stopLoss ?? order.stopLoss)
          : (orderPreview?.stopLoss ?? order?.stopLoss),
        takeProfit: canMoveExits
          ? (orderPreview?.takeProfit ?? order.takeProfit)
          : (orderPreview?.takeProfit ?? order?.takeProfit),
        canMoveExits,
        moveExits,
        preserveExits,
      };
    }
  };
  const startTouch = (overlay: OverlayGrab, x: number, y: number) => {
    if (overlay.kind !== 'line') {
      chipPress = { kind: overlay.kind, id: overlay.id, startX: x, startY: y, moved: false };
    } else {
      lineDrag = { line: overlay.line, id: overlay.id, startY: y, started: false, price: undefined };
    }
  };
  // Ends an overlay line drag. Clear the preview FIRST (repaint to snapshot),
  // then dispatch the §12 flow — same handlers the chart events used, so the
  // draft/auto-dispatch semantics are byte-identical. `dispatch=false` on a
  // pointercancel (gesture aborted, no modify).
  const finishLineDrag = (event: { pointerId?: number }, dispatch: boolean) => {
    const current = lineDrag;
    if (!current) {
      return;
    }
    lineDrag = null;
    const state = positionOverlayState.current;
    const hadPreview = state.drag !== null;
    if (!dispatch) {
      // Aborted gesture: revert to the snapshot immediately.
      state.drag = null;
      if (hadPreview) {
        chart.current?.refreshOverlays();
      }
    }
    // dispatch=true KEEPS the preview — the line stays at the released price
    // until the portfolio sync settles it (the synced level matches the
    // dragged one) or the modify is rejected. Clearing it here snapped the
    // line back to its pre-drag price for a few frames = the release flicker.
    if (event.pointerId !== undefined) {
      try {
        host.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    if (!dispatch || !current.started || current.price === undefined || current.price <= 0) {
      return;
    }
    if (current.line === 'order') {
      const delta = current.moveExits && current.orderPrice !== undefined ? current.price - current.orderPrice : 0;
      const includeExits = current.moveExits || current.preserveExits;
      const shifted = (level: number | undefined) => {
        if (level === undefined || !includeExits) {
          return undefined;
        }
        const next = level + delta;
        return Number.isFinite(next) && next > 0 ? next : level;
      };
      applyOrderModify({
        orderId: current.id,
        newPrice: current.price,
        stopLoss: shifted(current.stopLoss),
        takeProfit: shifted(current.takeProfit),
        autoDispatch: current.canMoveExits === true,
      });
    } else if (current.id.startsWith('order:')) {
      const orderId = current.id.slice('order:'.length);
      if (current.line === 'sl') {
        applyOrderLevelModify({ orderId, stopLoss: current.price });
      } else {
        applyOrderLevelModify({ orderId, takeProfit: current.price });
      }
    } else if (current.line === 'sl') {
      applyPositionModify({ positionId: current.id, stopLoss: current.price });
    } else {
      applyPositionModify({ positionId: current.id, takeProfit: current.price });
    }
  };
  // ✕ chip = click semantics: dispatch only on release of a still press
  // (within CHIP_CLICK_SLOP). A press-drag starting on the chip abandons —
  // closing a position is too destructive to fire from a pan attempt.
  const finishChip = (event: { pointerId?: number }, dispatch: boolean) => {
    const current = chipPress;
    if (!current) {
      return;
    }
    chipPress = null;
    if (event.pointerId !== undefined) {
      try {
        host.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    }
    if (!dispatch || current.moved) {
      return;
    }
    if (current.kind === 'posClose') {
      closeActionsRef.current?.close(current.id);
    } else if (current.kind === 'orderCancel') {
      closeActionsRef.current?.cancel(current.id);
    } else {
      applyLevelClear(current.kind === 'slClear' ? 'sl' : 'tp', current.id);
    }
  };
  const trackChip = (x: number, y: number) => {
    const current = chipPress;
    if (!current) {
      return;
    }
    if (Math.abs(x - current.startX) > CHIP_CLICK_SLOP || Math.abs(y - current.startY) > CHIP_CLICK_SLOP) {
      current.moved = true;
    }
  };
  return {
    get lineActive() {
      return lineDrag !== null;
    },
    get chipActive() {
      return chipPress !== null;
    },
    resolveGrab: resolveOverlayGrab,
    resolveLabelGrab,
    startPointer,
    startTouch,
    applyLineDrag,
    finishLineDrag,
    finishChip,
    trackChip,
  };
}
