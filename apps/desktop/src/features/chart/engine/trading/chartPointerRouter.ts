import { containsLabel } from './labels/containsLabel';
import { createStagedOrderGestures, type StagedOrderGestureTicket } from './stagedOrderGestures';
import { createTradingOverlayGestures } from './tradingOverlayGestures';
import type { StagedGestureWorkspace, TradingGestureWorkspace } from './gestureWorkspace';

/** React-side collaborators of the router; the engine never imports the tool registry or the stores. */
export type ChartPointerRouterDeps = StagedGestureWorkspace &
  TradingGestureWorkspace & {
    ticket: StagedOrderGestureTicket;
    /** Tool the chart returns to when Escape cancels the active tool. */
    defaultToolId: string;
    /** Mirrors the chart's return to the default tool in the React tool selection. */
    onDefaultToolSelected: () => void;
  };

type HostListenerOptions = boolean | { capture: boolean; passive: boolean };

/** One host listener whose add and remove calls come from the same entry, so they cannot drift apart. */
function hostListener<EventName extends keyof HTMLElementEventMap>(
  host: HTMLElement,
  type: EventName,
  handler: (event: HTMLElementEventMap[EventName]) => void,
  options?: HostListenerOptions,
) {
  return {
    attach: () => host.addEventListener(type, handler, options),
    detach: () => host.removeEventListener(type, handler, options),
  };
}

/**
 * Routes the chart host's pointer, touch and key events to three independent grab states: staged-widget
 * drags, custom-overlay line drags (library TradingDragHandler parity) and custom-overlay chip clicks,
 * with the active chart tool taking precedence on placement.
 */
export function createChartPointerRouter(host: HTMLElement, deps: ChartPointerRouterDeps) {
  const { chart, stagedOrderState, positionOverlayState, defaultToolId, onDefaultToolSelected } = deps;
  let toolGesture = false;
  const staged = createStagedOrderGestures(host, { stagedOrderState, chart }, deps.ticket);
  const trading = createTradingOverlayGestures(host, deps);
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
  /** Ends the staged drag, the line drag and the chip press; only a release dispatches. */
  const finishAllGestures = (event: { pointerId?: number }, dispatch: boolean) => {
    staged.endDrag(event);
    trading.finishLineDrag(event, dispatch);
    trading.finishChip(event, dispatch);
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
      finishAllGestures(event, false);
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
    finishAllGestures(event, true);
  };
  const onPointerCancel = (event: PointerEvent) => {
    chart.current?.toolPointerUp('cancelled');
    toolGesture = false;
    finishAllGestures(event, false);
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
  const onTouchEnd = (event: TouchEvent) => {
    if (!staged.active && !trading.lineActive && !trading.chipActive) {
      return;
    }
    claimEvent(event);
    staged.reset(); // staged widget writes ticket fields live — nothing to dispatch
    trading.finishLineDrag({}, true);
    trading.finishChip({}, true);
  };
  const onTouchCancel = () => {
    staged.reset();
    trading.finishLineDrag({}, false);
    trading.finishChip({}, false);
    chart.current?.toolPointerUp('cancelled');
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
      chart.current?.selectChartTool(defaultToolId);
      onDefaultToolSelected();
      event.preventDefault();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      chart.current?.drawings.deleteSelected();
      event.preventDefault();
    }
  };

  const nonPassiveCapture = { capture: true, passive: false };
  const listeners = [
    hostListener(host, 'keydown', onKeyDown),
    hostListener(host, 'pointerdown', onPointerDown, true),
    hostListener(host, 'contextmenu', onContextMenu),
    hostListener(host, 'pointermove', onPointerMove),
    hostListener(host, 'pointerleave', onPointerLeave),
    hostListener(host, 'pointerup', onPointerUp),
    hostListener(host, 'pointercancel', onPointerCancel),
    hostListener(host, 'lostpointercapture', onPointerCancel),
    hostListener(host, 'touchstart', onTouchStart, nonPassiveCapture),
    hostListener(host, 'touchmove', onTouchMove, nonPassiveCapture),
    hostListener(host, 'touchend', onTouchEnd, nonPassiveCapture),
    hostListener(host, 'touchcancel', onTouchCancel, nonPassiveCapture),
  ];
  return {
    /** Starts routing; the returned function stops it again. */
    attach(): () => void {
      for (const listener of listeners) {
        listener.attach();
      }
      return () => {
        for (const listener of listeners) {
          listener.detach();
        }
      };
    },
  };
}
