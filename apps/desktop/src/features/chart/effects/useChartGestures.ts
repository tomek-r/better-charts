import { containsLabel } from '../engine/labelLayout';
import { useEffect } from 'react';
import { useEventCallback } from '../../../shared/hooks/useEventCallback';
import { createStagedOrderGestures, type StagedOrderGestureTicket } from '../engine/stagedOrderGestures';
import { createTradingOverlayGestures } from '../engine/tradingOverlayGestures';
import { DEFAULT_CHART_TOOL_ID } from '../../tools/registry';
import type { ChartWorkspaceState } from '../state/useChartWorkspace';
import { useChartGestureDiagnostics } from './useChartGestureDiagnostics';

// Test-only hook: `import.meta.env.DEV` is a build-time constant, so production
// builds drop the diagnostics module and this stays a stable per-build hook.
const useDiagnostics: (workspace: ChartWorkspaceState) => void = import.meta.env.DEV
  ? useChartGestureDiagnostics
  : () => undefined;

export function useChartWorkspacePointerEffects(
  workspace: ChartWorkspaceState,
  ticket: StagedOrderGestureTicket,
): void {
  const {
    chartHost,
    chart,
    stagedOrderState,
    positionOverlayState,
    closeActionsRef,
    partialCloseChipPortRef,
    selectChartTool,
  } = workspace;
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
  const applyOrderModify = useEventCallback(workspace.applyOrderModify);
  const applyOrderLevelModify = useEventCallback(workspace.applyOrderLevelModify);
  const applyPositionModify = useEventCallback(workspace.applyPositionModify);
  const applyLevelClear = useEventCallback(workspace.applyLevelClear);

  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    // Three independent grab states: staged-widget drags, custom-overlay line
    // drags (library TradingDragHandler parity), custom-overlay ✕ chip clicks.
    let toolGesture = false;
    const staged = createStagedOrderGestures(
      host,
      { stagedOrderState, chart },
      {
        unstageOrderDraft,
        toggleExit,
        setEntry,
        setSlOn,
        setStopLoss,
        setTpOn,
        setTakeProfit,
        setStagedDragging,
        setDragSlMoney,
      },
    );
    const trading = createTradingOverlayGestures(host, {
      positionOverlayState,
      chart,
      applyOrderModify,
      applyOrderLevelModify,
      applyPositionModify,
      applyLevelClear,
      closeActionsRef,
      partialCloseChipPortRef,
    });
    // Paint and pointer hit tests share the chart host CSS-pixel frame.
    const frameRect = () => host.getBoundingClientRect();
    const localPoint = (event: { clientX: number; clientY: number }) => {
      const rect = frameRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    /** Pane-local point of a one-finger touch; multi-touch is left to the library's pinch handling. */
    const singleTouchPoint = (event: TouchEvent) =>
      event.touches.length === 1 ? localPoint(event.touches[0]) : undefined;
    /** A custom gesture owns this event: the chart's own handlers must not also act on it. */
    const claimEvent = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    let labelDragOffset = 0;
    const labelAt = (x: number, y: number) =>
      [...(positionOverlayState.current.hit.labels ?? []), ...(stagedOrderState.current.hit.labels ?? [])].find((row) =>
        containsLabel(row, x, y),
      );
    const setLabelDragOffset = (row: ReturnType<typeof labelAt>, y: number) => {
      labelDragOffset = row && Math.abs(row.y + row.h / 2 - row.lineY) > 1 ? y - row.lineY : 0;
    };
    /**
     * Hit-tests the label under the pointer and what it grabs: a staged-order
     * target first, otherwise (only then) a live trading overlay.
     */
    const locateGrab = (x: number, y: number) => {
      const row = labelAt(x, y);
      setLabelDragOffset(row, y);
      let target = row ? null : staged.resolveGrab(x, y);
      if (row?.source === 'staged') {
        target = staged.resolveLabelGrab(row.level, x, y);
      }
      if (target) {
        return { target, overlay: null };
      }
      let overlay = row ? null : trading.resolveGrab(x, y);
      if (row?.source === 'trading') {
        overlay = trading.resolveLabelGrab(row, x, y);
      }
      return { target: null, overlay };
    };
    const onPointerDown = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      host.focus({ preventScroll: true });
      if (chart.current?.isPlacementToolActive() && chart.current.toolPointerDown(x, y)) {
        toolGesture = true;
        claimEvent(event);
        host.setPointerCapture(event.pointerId);
        return;
      }
      const { target, overlay } = locateGrab(x, y);
      if (target) {
        if (staged.applyGrab(target, event)) {
          try {
            host.setPointerCapture(event.pointerId);
          } catch {
            /* capture unsupported */
          }
        }
        return;
      }
      if (!overlay) {
        if (chart.current?.toolPointerDown(x, y)) {
          toolGesture = true;
          claimEvent(event);
          host.setPointerCapture(event.pointerId);
        }
        return;
      }
      if ((overlay.kind === 'posClose' || overlay.kind === 'posPartial') && event.button !== 0) {
        return; // secondary buttons never act on a press; right-click is handled by `contextmenu`
      }
      event.stopPropagation();
      event.preventDefault(); // suppresses the compat mousedown → chart pan/draw never starts
      trading.startPointer(overlay, x, overlay.kind === 'line' ? y - labelDragOffset : y, event.shiftKey);
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        /* capture unsupported */
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      const { x, y } = localPoint(event);
      if (trading.openPartialMenuFor(locateGrab(x, y).overlay)) {
        claimEvent(event);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      // Pointer labels follow every tool without consuming events or taking
      // ownership from the gesture paths below.
      chart.current?.movePointerReadout(x, y);
      if (chart.current?.toolPointerMove(x, y)) {
        event.stopPropagation();
        return;
      }
      if (!staged.active && !trading.lineActive && !trading.chipActive) {
        return;
      }
      // Self-heal: button released outside our tracking (missed pointerup /
      // lost capture) — a stuck grab would swallow every later event.
      if (event.buttons === 0) {
        staged.endDrag(event);
        trading.finishLineDrag(event, false);
        trading.finishChip(event, false);
        return;
      }
      if (trading.chipActive) {
        trading.trackChip(x, y);
        return;
      }
      event.stopPropagation();
      if (staged.active) {
        staged.applyDrag(y - labelDragOffset, event.shiftKey);
      } else {
        trading.applyLineDrag(y - labelDragOffset, event.shiftKey);
      }
    };
    // Leaving the chart drops the pointer readout (and the active tool's hover): they
    // have no meaning once there is no pointer over the pane to point at.
    const onPointerLeave = () => {
      chart.current?.hidePointerReadout();
    };
    const onPointerUp = (event: PointerEvent) => {
      chart.current?.toolPointerUp('released');
      toolGesture = false;
      staged.endDrag(event);
      trading.finishLineDrag(event, true);
      trading.finishChip(event, true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      chart.current?.toolPointerUp('cancelled');
      toolGesture = false;
      staged.endDrag(event);
      trading.finishLineDrag(event, false);
      trading.finishChip(event, false);
    };
    // Suppress compatibility TouchEvents only while a custom gesture owns
    // capture; otherwise the library handles native touch pan and pinch.
    const onTouchStart = (event: TouchEvent) => {
      if (toolGesture || staged.active || trading.lineActive || trading.chipActive) {
        claimEvent(event);
        return;
      }
      const point = singleTouchPoint(event);
      if (!point) {
        return;
      }
      const { x, y } = point;
      const { target, overlay } = locateGrab(x, y);
      if (target) {
        staged.applyGrab(target, event);
        return;
      }
      if (!overlay) {
        return;
      }
      claimEvent(event);
      trading.startTouch(overlay, x, overlay.kind === 'line' ? y - labelDragOffset : y);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (toolGesture) {
        claimEvent(event);
        return;
      }
      const point = singleTouchPoint(event);
      if (!point) {
        return;
      }
      const { x, y } = point;
      if (trading.chipActive) {
        trading.trackChip(x, y);
        claimEvent(event);
        return;
      }
      if (staged.active) {
        claimEvent(event);
        staged.applyDrag(y - labelDragOffset);
        return;
      }
      if (!trading.lineActive) {
        return;
      }
      claimEvent(event);
      trading.applyLineDrag(y - labelDragOffset);
    };
    const onTouchCancel = () => {
      staged.reset();
      trading.finishLineDrag({}, false);
      trading.finishChip({}, false);
      chart.current?.toolPointerUp('cancelled');
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!staged.active && !trading.lineActive && !trading.chipActive) {
        return;
      }
      claimEvent(event);
      staged.reset(); // staged widget writes ticket fields live — nothing to dispatch
      trading.finishLineDrag({}, true);
      trading.finishChip({}, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== host) {
        return;
      }
      if (event.key === 'Escape') {
        toolGesture = false;
        staged.reset();
        trading.finishLineDrag({}, false);
        trading.finishChip({}, false);
        chart.current?.cancelToolGestures();
        chart.current?.selectChartTool(DEFAULT_CHART_TOOL_ID);
        selectChartTool(DEFAULT_CHART_TOOL_ID);
        event.preventDefault();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        chart.current?.deleteDrawings();
        event.preventDefault();
      }
    };
    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('contextmenu', onContextMenu);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerCancel);
    host.addEventListener('lostpointercapture', onPointerCancel);
    host.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    host.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    host.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    host.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: false });
    return () => {
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('contextmenu', onContextMenu);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerCancel);
      host.removeEventListener('lostpointercapture', onPointerCancel);
      host.removeEventListener('touchstart', onTouchStart, { capture: true });
      host.removeEventListener('touchmove', onTouchMove, { capture: true });
      host.removeEventListener('touchend', onTouchEnd, { capture: true });
      host.removeEventListener('touchcancel', onTouchCancel, { capture: true });
    };
  }, [
    chartHost,
    chart,
    stagedOrderState,
    positionOverlayState,
    closeActionsRef,
    partialCloseChipPortRef,
    selectChartTool,
    unstageOrderDraft,
    toggleExit,
    setEntry,
    setSlOn,
    setStopLoss,
    setTpOn,
    setTakeProfit,
    setStagedDragging,
    setDragSlMoney,
    applyOrderModify,
    applyOrderLevelModify,
    applyPositionModify,
    applyLevelClear,
  ]);
  useDiagnostics(workspace);
}
