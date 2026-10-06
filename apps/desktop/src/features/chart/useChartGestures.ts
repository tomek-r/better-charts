import { containsLabel } from './engine/labelLayout';
import { useEffect } from 'react';
import { createStagedOrderGestures } from './engine/stagedOrderGestures';
import { createTradingOverlayGestures } from './engine/tradingOverlayGestures';
import type { OrderTicketState } from '../order-ticket/state/useOrderTicket';
import type { ChartWorkspaceState } from './useChartWorkspace';
import { useChartGestureDiagnostics } from './useChartGestureDiagnostics';

export function useChartWorkspacePointerEffects(workspace: ChartWorkspaceState, ticket: OrderTicketState): void {
  const { chartHost, chart } = workspace;

  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    // Three independent grab states: staged-widget drags, custom-overlay line
    // drags (library TradingDragHandler parity), custom-overlay ✕ chip clicks.
    let profileGesture = false;
    const staged = createStagedOrderGestures(host, workspace, ticket);
    const trading = createTradingOverlayGestures(host, workspace);
    // Paint and pointer hit tests share the chart host CSS-pixel frame.
    const frameRect = () => host.getBoundingClientRect();
    const localPoint = (event: { clientX: number; clientY: number }) => {
      const rect = frameRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    let labelDragOffset = 0;
    const labelAt = (x: number, y: number) =>
      [
        ...(workspace.positionOverlayState.current.hit.labels ?? []),
        ...(workspace.stagedOrderState.current.hit.labels ?? []),
      ].find((row) => containsLabel(row, x, y));
    const setLabelDragOffset = (row: ReturnType<typeof labelAt>, y: number) => {
      labelDragOffset = row && Math.abs(row.y + row.h / 2 - row.lineY) > 1 ? y - row.lineY : 0;
    };
    const onPointerDown = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      host.focus({ preventScroll: true });
      if (chart.current?.isProfileToolActive() && chart.current.profilePointerDown(x, y)) {
        profileGesture = true;
        event.stopPropagation();
        event.preventDefault();
        host.setPointerCapture(event.pointerId);
        return;
      }
      const row = labelAt(x, y);
      setLabelDragOffset(row, y);
      let target = row ? null : staged.resolveGrab(x, y);
      if (row?.source === 'staged') {
        target = staged.resolveLabelGrab(row.level, x, y);
      }
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
      let overlay = row ? null : trading.resolveGrab(x, y);
      if (row?.source === 'trading') {
        overlay = trading.resolveLabelGrab(row, x, y);
      }
      if (!overlay) {
        if (chart.current?.profilePointerDown(x, y)) {
          profileGesture = true;
          event.stopPropagation();
          event.preventDefault();
          host.setPointerCapture(event.pointerId);
        }
        return;
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
    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      // Pointer labels follow every tool without consuming events or taking
      // ownership from the gesture paths below.
      chart.current?.moveCrosshair(x, y);
      if (chart.current?.profilePointerMove(x)) {
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
    // Leaving the chart drops the crosshair: it is a pointer indicator, so it
    // has no meaning once there is no pointer over the pane to point at.
    const onPointerLeave = () => {
      chart.current?.hideCrosshair();
    };
    const onPointerUp = (event: PointerEvent) => {
      chart.current?.profilePointerUp(true);
      profileGesture = false;
      staged.endDrag(event);
      trading.finishLineDrag(event, true);
      trading.finishChip(event, true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      chart.current?.profilePointerUp(false);
      profileGesture = false;
      staged.endDrag(event);
      trading.finishLineDrag(event, false);
      trading.finishChip(event, false);
    };
    // Suppress compatibility TouchEvents only while a custom gesture owns
    // capture; otherwise the library handles native touch pan and pinch.
    const onTouchStart = (event: TouchEvent) => {
      if (profileGesture || staged.active || trading.lineActive || trading.chipActive) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.touches.length !== 1) {
        return;
      }
      const { x, y } = localPoint(event.touches[0]);
      const row = labelAt(x, y);
      setLabelDragOffset(row, y);
      let target = row ? null : staged.resolveGrab(x, y);
      if (row?.source === 'staged') {
        target = staged.resolveLabelGrab(row.level, x, y);
      }
      if (target) {
        staged.applyGrab(target, event);
        return;
      }
      let overlay = row ? null : trading.resolveGrab(x, y);
      if (row?.source === 'trading') {
        overlay = trading.resolveLabelGrab(row, x, y);
      }
      if (!overlay) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      trading.startTouch(overlay, x, overlay.kind === 'line' ? y - labelDragOffset : y);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (profileGesture) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.touches.length !== 1) {
        return;
      }
      const { x, y } = localPoint(event.touches[0]);
      if (trading.chipActive) {
        trading.trackChip(x, y);
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (staged.active) {
        event.stopPropagation();
        event.preventDefault();
        staged.applyDrag(y - labelDragOffset);
        return;
      }
      if (!trading.lineActive) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      trading.applyLineDrag(y - labelDragOffset);
    };
    const onTouchCancel = () => {
      staged.reset();
      trading.finishLineDrag({}, false);
      trading.finishChip({}, false);
      chart.current?.profilePointerUp(false);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!staged.active && !trading.lineActive && !trading.chipActive) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      staged.reset(); // staged widget writes ticket fields live — nothing to dispatch
      trading.finishLineDrag({}, true);
      trading.finishChip({}, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== host) {
        return;
      }
      if (event.key === 'Escape') {
        profileGesture = false;
        staged.reset();
        trading.finishLineDrag({}, false);
        trading.finishChip({}, false);
        chart.current?.cancelProfileGesture();
        chart.current?.setDrawingTool(null);
        workspace.setDrawingTool(null);
        event.preventDefault();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        chart.current?.deleteProfile();
        event.preventDefault();
      }
    };
    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('pointerdown', onPointerDown, true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useChartGestureDiagnostics(workspace);
}
