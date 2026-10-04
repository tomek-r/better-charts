import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChartController } from './engine/chartController';
import type { DrawingTool } from '../tools/toolTypes';
import { Mt5DataAdapter } from './engine/mt5DataAdapter';
import { type FixedRangeProfileState } from './engine/fixedRangeProfileOverlay';
import {
  hitCircle,
  hitRect,
  STAGED_GRAB,
  type StagedOrderState,
  type StagedOrderLevels,
} from './engine/stagedOrderOverlay';
import { TRADING_GRAB, LINE_DRAG_THRESHOLD, type PositionOverlayState } from './engine/positionOverlay';
import { type PriceLinesState } from './engine/priceLinesOverlay';
import type { PendingModification } from '../../shared/bridge/types';
import { levelMoneyText } from './engine/overlayLines';
import { quoteDigits, ticketPrice, draftLevel, formatSignedMoney } from '../../shared/format';
import { orderEntryPrice, riskRewardRatio } from '../order-ticket/ticketRules';
import type { BridgeSessionState } from '../bridge/useBridgeSession';
import type { OrderTicketState } from '../order-ticket/useOrderTicket';
import type { useExecutionCommands } from '../execution/useExecutionCommands';

/** Grab targets of OUR position/order overlay (capture-phase handlers here). */
type OverlayGrab =
  | { kind: 'posClose'; id: string }
  | { kind: 'orderCancel'; id: string }
  | { kind: 'slClear'; id: string }
  | { kind: 'tpClear'; id: string }
  | { kind: 'line'; line: 'order' | 'sl' | 'tp'; id: string };

/**
 * The rail's tool flyout, when open, owns Escape: it closes itself and restores
 * focus, and its own document-level handler stops the event from reaching the
 * chart shortcuts. This is the guard for the shortcuts that run BEFORE that
 * handler (a window capture-phase listener), which cannot rely on it.
 */
const toolFlyoutOpen = () => document.querySelector('.tool-flyout') !== null;

export function useChartWorkspace() {
  // Shared (never re-created) state for the FIXED RANGE VOLUME PROFILE: the
  // gesture commits write the fixed range and profile; the painter writes hit
  // geometry (see features/chart/engine/fixedRangeProfileOverlay.ts). Mutate fields only — the
  // plugin captures this object at mount.
  const fixedRangeProfileState = useRef<FixedRangeProfileState>({ range: null, hit: {} });
  // Shared (never re-created) state for the staged-order widget overlay: the
  // renderer writes hit geometry every frame; App's mirror effect writes the
  // ticket values; the host pointer handlers read both. No polling, no chart
  // internals — see features/chart/engine/stagedOrderOverlay.ts for the mechanism contract.
  const stagedOrderState = useRef<StagedOrderState>({ order: null, digits: 2, hit: {} });
  // Shared (never re-created) state for OUR position/order overlay: the painter
  // writes hit geometry every frame; the sync effect writes the portfolio
  // lines; the host pointer handlers read both — see features/chart/engine/positionOverlay.ts.
  const positionOverlayState = useRef<PositionOverlayState>({
    positions: [],
    orders: [],
    digits: 2,
    drag: null,
    hit: {},
  });
  // Live bid/ask price lines overlay state — the quote effect writes the
  // prices, the painter writes hit geometry (see features/chart/engine/priceLinesOverlay.ts).
  const priceLinesState = useRef<PriceLinesState>({ digits: 2, hit: {} });
  // The chart SL/TP drag handlers bind once at mount; they read this render's
  // dispatch gate and auto-dispatch path through this ref (drag events fire only
  // after a commit, so the stored closure always carries fresh state).
  const dragModifyRef = useRef<{ enabled: boolean; dispatch: (draft: PendingModification) => void } | undefined>(
    undefined,
  );
  // Fresh ✕ dispatchers for the custom overlay's close/cancel chips: the
  // capture handlers mount once, but requestClosePosition/requestCancelOrder
  // close over account/closingTarget state — same ref pattern as dragModifyRef.
  const closeActionsRef = useRef<
    { close: (positionId: string) => void; cancel: (orderId: string) => void } | undefined
  >(undefined);
  // Instrument digits for price normalization inside []-dep chart handlers.
  const instrumentDigitsRef = useRef<number | undefined>(undefined);
  // Fresh staged flag for the []-dep Escape handler (unstage only when staged).
  const stagedActiveRef = useRef(false);
  const expectedProfile = useRef<{ symbol: string; fromMs: number; endMs: number; generation: number } | undefined>(
    undefined,
  );
  const profileGeneration = useRef(0);
  const lastRequestedRangeRef = useRef<{ fromMs: number; endMs: number } | undefined>(undefined);
  const chartHost = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartController | null>(null);
  const adapterRef = useRef<Mt5DataAdapter | null>(null);
  const [pendingModification, setPendingModification] = useState<PendingModification>();
  const [tradingSyncTick, setTradingSyncTick] = useState(0);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(null);
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
    fixedRangeProfileState,
    stagedOrderState,
    positionOverlayState,
    priceLinesState,
    dragModifyRef,
    closeActionsRef,
    instrumentDigitsRef,
    stagedActiveRef,
    expectedProfile,
    profileGeneration,
    lastRequestedRangeRef,
    chartHost,
    chart,
    adapterRef,
    pendingModification,
    setPendingModification,
    tradingSyncTick,
    drawingTool,
    setDrawingTool,
    recordDraft,
    applyPositionModify,
    applyOrderModify,
    applyOrderLevelModify,
    applyLevelClear,
  };
}

export type ChartWorkspaceState = ReturnType<typeof useChartWorkspace>;

/** The §12 execution actions App passes to the dispatch-ref mirror slot. */
export type ChartWorkspaceExecutionActions = Pick<
  ReturnType<typeof useExecutionCommands>,
  'requestModifyDraft' | 'requestClosePosition' | 'requestCancelOrder'
>;

export function useChartWorkspaceInitEffects(workspace: ChartWorkspaceState, session: BridgeSessionState): void {
  const {
    chartHost,
    chart,
    adapterRef,
    fixedRangeProfileState,
    positionOverlayState,
    stagedOrderState,
    priceLinesState,
    setDrawingTool,
    expectedProfile,
    profileGeneration,
    lastRequestedRangeRef,
  } = workspace;
  const { setChartError, requestProfileRange } = session;
  const chartRef = chart;
  useLayoutEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    const adapter = new Mt5DataAdapter();
    adapterRef.current = adapter;
    let instance: ChartController | undefined;
    try {
      instance = new ChartController(host, {
        fixedRangeProfile: fixedRangeProfileState.current,
        positions: positionOverlayState.current,
        staged: stagedOrderState.current,
        priceLines: priceLinesState.current,
      });
      chartRef.current = instance;
      instance.onProfileCommit = (range) => requestProfileRange('gesture-committed', range);
      instance.onToolRelease = () => setDrawingTool(null);
      instance.onProfileDelete = () => {
        expectedProfile.current = undefined;
        profileGeneration.current += 1;
        lastRequestedRangeRef.current = undefined;
        void invoke('cancel_tick_profile').catch(() => undefined);
      };
    } catch (error) {
      setChartError('Chart renderer could not be initialized.');
      console.error(error);
    }
    return () => {
      instance?.destroy();
      adapter.dispose();
      if (chartRef.current === instance) {
        chartRef.current = null;
      }
      if (adapterRef.current === adapter) {
        adapterRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- One renderer/coordinator per mount; callbacks read refs.
  }, []);
  useEffect(() => {
    const cancelTool = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      chartRef.current?.setDrawingTool(null);
      setDrawingTool(null);
    };
    window.addEventListener('keydown', cancelTool);
    return () => window.removeEventListener('keydown', cancelTool);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Chart ref and setter are stable for this mount.
  }, []);
}

export function useChartWorkspaceChartEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
): void {
  const { chart, setPendingModification, priceLinesState } = workspace;
  const {
    instrument,
    quote,
    loadingTimeframe,
    snapshot,
    setLoadingTimeframe,
    setChartError,
    currentSymbol,
    setQuote,
    setInstrument,
    targetSymbol,
    status,
  } = session;
  const { clearStagedWidget } = ticket;
  const priceLinesRef = priceLinesState;
  const currentSymbolRef = currentSymbol;
  useEffect(() => {
    chart.current?.setConnectionStatus(
      status.state,
      status.message,
      `${status.terminal ?? ''}|${status.account ?? ''}|${status.server ?? ''}`,
    );
  }, [chart, status.state, status.message, status.terminal, status.account, status.server]);
  useEffect(() => {
    setPendingModification(undefined);
    clearStagedWidget();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: clearStagedWidget/submitSwapPendingRef come from the hook return (stable per mount); dep array frozen 1:1 with the former inline effect
  }, [snapshot.symbol, snapshot.timeframe]);
  // Live bid/ask price lines use the series' public Lightweight Charts API;
  // custom axis tags still use the overlay for spread-collision handling.
  useEffect(() => {
    const state = priceLinesRef.current;
    state.digits = instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : 2);
    chart.current?.setPricePrecision(state.digits);
    state.ask = quote && Number(quote.ask) > 0 ? Number(quote.ask) : undefined;
    state.bid = quote && Number(quote.bid) > 0 ? Number(quote.bid) : undefined;
    chart.current?.setBidAskPrices(state.ask, state.bid);
    chart.current?.setQuoteClock(quote);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5f: workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, [quote, instrument?.digits]);
  useEffect(() => {
    chart.current?.setCountdownPending(loadingTimeframe !== undefined);
    if (loadingTimeframe && snapshot.timeframe === loadingTimeframe) {
      setLoadingTimeframe(undefined);
      setChartError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5e: setChartError/setLoadingTimeframe come from useBridgeSession (setter identities erased by the return); dep array frozen 1:1
  }, [loadingTimeframe, snapshot.timeframe]);
  useEffect(() => {
    currentSymbolRef.current = snapshot.symbol;
    setQuote((previous) => (previous && previous.symbol === snapshot.symbol ? previous : undefined));
    setInstrument((previous) => {
      if (previous?.symbol === snapshot.symbol) {
        return previous;
      }
      if (targetSymbol.current === snapshot.symbol) {
        return previous;
      }
      return undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5e: `currentSymbol`/`targetSymbol` (hook-owned refs) + setQuote/setInstrument (hook-owned setters) — identities erased by the useBridgeSession return; dep array frozen 1:1
  }, [snapshot.symbol]);
  // Drawings are time/price anchored: a line drawn on one instrument is noise on
  // another (the stale-lines bug class), so a symbol change clears ALL drawings.
  // Timeframe changes keep drawings (standard chart behavior); the tracked dateRange
  // is evicted separately in the symbol/timeframe reset below.
  useEffect(() => {
    if (chart.current?.getProfileRange()) {
      chart.current.deleteProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5f: workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, [snapshot.symbol]);
}

export function useChartWorkspaceResetEffects(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
): void {
  const { chart, fixedRangeProfileState, expectedProfile, profileGeneration } = workspace;
  const {
    status,
    snapshot,
    loadingTimeframeRef,
    targetSymbol,
    pendingMetadata,
    setLoadingTimeframe,
    setQuote,
    setInstrument,
    setAccount,
    setPortfolio,
    setSymbolLoading,
  } = session;
  const { setEntry, setStopLoss, setTakeProfit } = ticket;
  const fixedRangeProfileRef = fixedRangeProfileState;
  const expectedProfileRef = expectedProfile;
  const profileGenerationRef = profileGeneration;
  const targetSymbolRef = targetSymbol;
  const pendingMetadataRef = pendingMetadata;
  useEffect(() => {
    if (status.state !== 'connected') {
      setLoadingTimeframe(undefined);
      loadingTimeframeRef.current = undefined;
      fixedRangeProfileRef.current.range = null;
      fixedRangeProfileState.current.profile = undefined;
      expectedProfileRef.current = undefined;
      profileGenerationRef.current += 1;
      chart.current?.clearProfileSelection();
      chart.current?.refreshOverlays();
      setSymbolLoading(false);
      targetSymbolRef.current = undefined;
      pendingMetadataRef.current = undefined;
      setQuote(undefined);
      setInstrument(undefined);
      setAccount(undefined);
      setPortfolio(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook-provided setter, stable identity (P5a)
  }, [status.state]);
  // SYMBOL change: the FRVP selection is instrument-specific — drop the range,
  // the drawing and the computed profile, bump the generation (the stale-event
  // guards stay armed) and reset the ticket draft.
  useLayoutEffect(() => {
    fixedRangeProfileRef.current.range = null;
    fixedRangeProfileState.current.profile = undefined;
    expectedProfileRef.current = undefined;
    profileGenerationRef.current += 1;
    if (chart.current?.getProfileRange()) {
      chart.current.deleteProfile();
    } else {
      chart.current?.clearProfileSelection();
    }
    chart.current?.refreshOverlays();
    setEntry('');
    setStopLoss('');
    setTakeProfit('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [snapshot.symbol]);
  // TIMEFRAME change: the profile is tick-based over a FIXED TIME range and the
  // drawing's anchors are time-based — both survive the switch. Only the layout
  // resize (new bar spacing) and the unrelated ticket reset apply here.
  useLayoutEffect(() => {
    chart.current?.refreshOverlays();
    setEntry('');
    setStopLoss('');
    setTakeProfit('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [snapshot.timeframe]);
}

export function useChartWorkspaceHotkeyEffect(workspace: ChartWorkspaceState, ticket: OrderTicketState): void {
  const { stagedActiveRef } = workspace;
  const { unstageOrderDraft } = ticket;
  // Escape also reaches the chart's document handler to cancel drawing tools.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('[data-app-settings-dialog]')) {
        return;
      }
      // The rail's tool flyout owns Escape while it is open (it closes itself and
      // restores focus); the chart-level Escape shortcuts defer to it.
      if (event.key === 'Escape' && toolFlyoutOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        if (stagedActiveRef.current) {
          unstageOrderDraft();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook-provided setter, stable identity (P5a); also covers pre-existing missing 'unstageOrderDraft'
  }, []);
}

export function useChartWorkspacePointerEffects(workspace: ChartWorkspaceState, ticket: OrderTicketState): void {
  const {
    chartHost,
    stagedOrderState,
    positionOverlayState,
    priceLinesState,
    fixedRangeProfileState,
    chart,
    applyOrderModify,
    applyOrderLevelModify,
    applyPositionModify,
    applyLevelClear,
    closeActionsRef,
  } = workspace;
  const { unstageOrderDraft, toggleExit, setEntry, setSlOn, setStopLoss, setTpOn, setTakeProfit } = ticket;
  // P5d: deriveOrderTicket (the gate/derivation call — arguments byte-identical,
  // domain frozen) and requestOrderCheck/submitOrder live in useOrderTicket.
  // ── Staged-order widget (own chart overlay, wave 2) ─────────────────────
  // Clicking Sell/Buy in the quote row stages OUR OWN TradingView-style widget
  // on the chart (features/chart/engine/stagedOrderOverlay.ts — a `ui`-layer overlay plugin,
  // so axis tags paint unclipped over the price axis). Mechanism contract: the
  // overlay paints from `stagedOrderState` and records hit-test geometry on
  // every frame; capture-phase pointer handlers bound to the chart HOST read
  // that geometry (±6px grab) and sync drags straight into the ticket fields —
  // no polling, no private chart APIs, no listeners inside the chart. Events
  // are stopPropagation'd ONLY while actually grabbing a widget element, so
  // pan/zoom/drawings keep working everywhere else. Nothing is ever dispatched
  // from here: CTA → review → Send order stays the only submit_order path.
  // P5d: clearStagedWidget / resetOrderDraft / resetTicketToDefaults /
  // stageOrderDraft / unstageOrderDraft / stageFromQuote moved to
  // useOrderTicket (content 1:1); App calls them through the hook return.
  // Capture-phase input on the chart host. One grab at a time; while no grab
  // is claimed every event passes through to the chart untouched.
  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    // Three independent grab states: staged-widget drags, custom-overlay line
    // drags (library TradingDragHandler parity), custom-overlay ✕ chip clicks.
    let profileGesture = false;
    let drag: 'entry' | 'sl' | 'tp' | null = null;
    let stagedEntryDrag: {
      entry: number;
      stopLoss: number | null;
      takeProfit: number | null;
      canMoveExits: boolean;
      moveExits: boolean;
    } | null = null;
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
    // Paint and pointer hit tests share the chart host CSS-pixel frame.
    const frameRect = () => host.getBoundingClientRect();
    const localPoint = (event: { clientX: number; clientY: number }) => {
      const rect = frameRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
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
      const target = resolveGrab(x, y);
      if (target) {
        if (applyGrab(target, event)) {
          try {
            host.setPointerCapture(event.pointerId);
          } catch {
            /* capture unsupported */
          }
        }
        return;
      }
      const overlay = resolveOverlayGrab(x, y);
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
        const moveExits = event.shiftKey && canMoveExits;
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
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        /* capture unsupported */
      }
    };
    const endDrag = (event: { pointerId?: number }) => {
      if (!drag) {
        return;
      }
      drag = null;
      stagedEntryDrag = null;
      if (event.pointerId !== undefined) {
        try {
          host.releasePointerCapture(event.pointerId);
        } catch {
          /* already released */
        }
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
    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = localPoint(event);
      // The Cross tool follows the pointer without consuming the event; every
      // other gesture path below is unaffected (crosshair is not a profile tool).
      chart.current?.moveCrosshair(x, y);
      if (chart.current?.profilePointerMove(x)) {
        event.stopPropagation();
        return;
      }
      if (!drag && !lineDrag && !chipPress) {
        return;
      }
      // Self-heal: button released outside our tracking (missed pointerup /
      // lost capture) — a stuck grab would swallow every later event.
      if (event.buttons === 0) {
        endDrag(event);
        finishLineDrag(event, false);
        finishChip(event, false);
        return;
      }
      if (chipPress) {
        trackChip(x, y);
        return;
      }
      event.stopPropagation();
      if (drag) {
        applyDrag(y, event.shiftKey);
      } else {
        applyLineDrag(y, event.shiftKey);
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
      endDrag(event);
      finishLineDrag(event, true);
      finishChip(event, true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      chart.current?.profilePointerUp(false);
      profileGesture = false;
      endDrag(event);
      finishLineDrag(event, false);
      finishChip(event, false);
    };
    // Suppress compatibility TouchEvents only while a custom gesture owns
    // capture; otherwise the library handles native touch pan and pinch.
    const onTouchStart = (event: TouchEvent) => {
      if (profileGesture || drag || lineDrag || chipPress) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.touches.length !== 1) {
        return;
      }
      const { x, y } = localPoint(event.touches[0]);
      const target = resolveGrab(x, y);
      if (target) {
        applyGrab(target, event);
        return;
      }
      const overlay = resolveOverlayGrab(x, y);
      if (!overlay) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      if (overlay.kind !== 'line') {
        chipPress = { kind: overlay.kind, id: overlay.id, startX: x, startY: y, moved: false };
      } else {
        lineDrag = { line: overlay.line, id: overlay.id, startY: y, started: false, price: undefined };
      }
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
      if (chipPress) {
        trackChip(x, y);
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (drag) {
        event.stopPropagation();
        event.preventDefault();
        applyDrag(y);
        return;
      }
      if (!lineDrag) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      applyLineDrag(y);
    };
    const onTouchCancel = () => {
      drag = null;
      stagedEntryDrag = null;
      finishLineDrag({}, false);
      finishChip({}, false);
      chart.current?.profilePointerUp(false);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!drag && !lineDrag && !chipPress) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      drag = null; // staged widget writes ticket fields live — nothing to dispatch
      stagedEntryDrag = null;
      finishLineDrag({}, true);
      finishChip({}, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== host) {
        return;
      }
      if (event.key === 'Escape') {
        profileGesture = false;
        drag = null;
        stagedEntryDrag = null;
        finishLineDrag({}, false);
        finishChip({}, false);
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
  // DEV-only test hook (stripped from production builds by import.meta.env.DEV):
  // exposes painted widget geometry in PAGE coordinates plus the exact price a
  // drag at clientY would write, so the E2E drives REAL pointer gestures against
  // the canvas instead of asserting pixels (chart-assertion-free rule).
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    type Api = {
      geometry: () => Record<string, unknown> | null;
      expectedPrice: (clientY: number) => string | null;
      fixedRangeProfile: () => { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
      realTrading: () => Record<string, unknown> | null;
    };
    const api: Api = {
      realTrading: () => {
        const rect = chartHost.current?.getBoundingClientRect();
        if (!rect) {
          return null;
        }
        const hit = positionOverlayState.current.hit;
        const chips = (rows: Array<{ id: string; x: number; y: number; r: number }> = []) =>
          rows.map((row) => ({ ...row, x: row.x + rect.left, y: row.y + rect.top }));
        const lines = (rows: Array<{ id: string; y: number }> = []) =>
          rows.map((row) => ({ ...row, y: row.y + rect.top }));
        return {
          posCloses: chips(hit.posCloses),
          orderCancels: chips(hit.orderCancels),
          slLines: lines(hit.slLines),
          tpLines: lines(hit.tpLines),
          orderLines: lines(hit.orderLines),
        };
      },
      geometry: () => {
        const host = chartHost.current;
        const rect = host?.getBoundingClientRect();
        if (!rect) {
          return null;
        }
        const state = stagedOrderState.current;
        const hit = state.hit;
        const viewport = chart.current?.diagnosticViewport();
        const circle = (c: { x: number; y: number; r: number } | undefined) =>
          c ? { x: rect.left + c.x, y: rect.top + c.y, r: c.r } : null;
        const box = (b: { x: number; y: number; w: number; h: number } | undefined) =>
          b ? { x: rect.left + b.x, y: rect.top + b.y, w: b.w, h: b.h } : null;
        return {
          staged: state.order !== null,
          container: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          entryLineY: hit.entryLineY !== undefined ? rect.top + hit.entryLineY : null,
          entryCancel: circle(hit.entryCancel),
          slCancel: circle(hit.slCancel),
          tpCancel: circle(hit.tpCancel),
          slHandle: box(hit.slHandle),
          tpHandle: box(hit.tpHandle),
          slMoney: state.order?.slMoney ?? null,
          tpMoney: state.order?.tpMoney ?? null,
          chartRect: hit.chartRect
            ? {
                x: rect.left + hit.chartRect.x,
                y: rect.top + hit.chartRect.y,
                width: hit.chartRect.width,
                height: hit.chartRect.height,
              }
            : null,
          visibleRange: hit.visibleRange ?? null,
          priceRange: hit.priceRange ?? null,
          barSpacing: hit.barSpacing ?? null,
          barWidth: hit.barWidth ?? null,
          digits: state.digits,
          // Panning geometry (for E2E gestures): where the viewport is, where
          // scrollToEnd would land it, and whether follow-on-new-bar is armed.
          offset: viewport?.offset ?? null,
          endAnchor: viewport?.endAnchor ?? null,
          followArmed: viewport?.followArmed ?? null,
          askY: priceLinesState.current.hit.askY !== undefined ? rect.top + priceLinesState.current.hit.askY : null,
          bidY: priceLinesState.current.hit.bidY !== undefined ? rect.top + priceLinesState.current.hit.bidY : null,
        };
      },
      // Same clamp -> transform -> round chain applyDrag uses, so the expected
      // ticket value for a drop at clientY is exact, not approximate.
      expectedPrice: (clientY) => {
        const host = chartHost.current;
        const rect = host?.getBoundingClientRect();
        const hit = stagedOrderState.current.hit;
        if (!rect || !hit.chartRect || !hit.toPrice) {
          return null;
        }
        const y = Math.min(Math.max(clientY - rect.top, hit.chartRect.y), hit.chartRect.y + hit.chartRect.height);
        const price = hit.toPrice(y);
        return Number.isFinite(price) && price > 0 ? ticketPrice(price, stagedOrderState.current.digits) : null;
      },
      // FRVP lifecycle surface for the E2E: the active fixed-range selection
      // (null = cleared) plus whether its computed profile is loaded — proves
      // the selection survives a timeframe switch and dies on a symbol switch.
      fixedRangeProfile: () => {
        const range = fixedRangeProfileState.current.range;
        return {
          range: range ? { fromMs: range.fromMs, toMs: range.toMs } : null,
          hasProfile:
            fixedRangeProfileState.current.profile !== undefined && !fixedRangeProfileState.current.previewing,
        };
      },
    };
    (window as unknown as { __stagedWidgetTest?: Api }).__stagedWidgetTest = api;
    return () => {
      delete (window as unknown as { __stagedWidgetTest?: Api }).__stagedWidgetTest;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5f: workspace/session/ticket bindings are not provably stable in this scope; dep array frozen 1:1 with the former App effect
  }, []);
}

export function useChartWorkspaceMirrorRefEffect(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
  execution: ChartWorkspaceExecutionActions,
  dispatchEnabledNow: boolean,
): void {
  const { dragModifyRef, closeActionsRef, instrumentDigitsRef, stagedActiveRef } = workspace;
  const { instrument } = session;
  const { stagedOnChart } = ticket;
  const { requestModifyDraft, requestClosePosition, requestCancelOrder } = execution;
  // Fresh view for the once-mounted chart drag handlers: the live dispatch gate
  // (position SL/TP and pending Limit/Stop Limit drags auto-dispatch when enabled) plus the
  // ✕-chip close/cancel actions. Assigned in an effect (runs after every commit)
  // so render stays pure.
  useEffect(() => {
    dragModifyRef.current = { enabled: dispatchEnabledNow, dispatch: (draft) => requestModifyDraft(draft, true) };
    closeActionsRef.current = {
      close: (positionId) => requestClosePosition('portfolio', positionId),
      cancel: (orderId) => requestCancelOrder('portfolio', orderId),
    };
    instrumentDigitsRef.current = instrument?.digits;
    stagedActiveRef.current = stagedOnChart;
  });
}

export function useChartWorkspaceMirrorLayoutEffect(
  workspace: ChartWorkspaceState,
  session: BridgeSessionState,
  ticket: OrderTicketState,
): void {
  const { chart, stagedOrderState, instrumentDigitsRef } = workspace;
  const { instrument, quote, snapshot, account } = session;
  const {
    submitSwapPendingRef,
    stagedPrevPriceRef,
    stagedOnChart,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    riskSide,
    effectiveVolume,
    riskAmount,
    riskPreview,
    riskPreviewDisplayRef,
    riskVersion,
    volumeManual,
    stopGuard,
    unitsMode,
    orderKind,
    limitPrice,
  } = ticket;
  const stagedOrderRef = stagedOrderState;
  // Signed P&L at an exit level in the ACCOUNT currency (owner: "TP +$60,
  // SL -$50 — waluta wybrana, nie zahardkodowana"): (level − entry) × side ×
  // contractSize × volume — the same estimate basis as the ticket's Tick value
  // (the broker's true tick value is not exposed by the bridge). Only for SET
  // levels: undefined keeps the plain SL/TP handle label.
  const levelMoney = (level: number | null): string | undefined => {
    const entryPrice = Number(orderEntryPrice(orderKind, entry, limitPrice));
    const volume = Number(effectiveVolume);
    const contract = instrument ? Number(instrument.contractSize) : NaN;
    const currency = account?.currency?.trim();
    if (level === null || !Number.isFinite(level) || !currency) {
      return undefined;
    }
    if (
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0 ||
      !Number.isFinite(volume) ||
      volume <= 0 ||
      !Number.isFinite(contract) ||
      contract <= 0
    ) {
      return undefined;
    }
    const direction = riskSide === 'buy' ? 1 : -1;
    const value = (level - entryPrice) * direction * contract * volume;
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return formatSignedMoney(value, currency);
  };
  // Mirror the ticket into the staged widget every relevant edit (two-way sync:
  // widget drags write the ticket fields, ticket edits move the widget lines)
  // and repaint the chart so the ui-layer overlay re-renders with fresh geometry.
  useLayoutEffect(() => {
    // Frozen after a SENT order: the painted draft stays until the fill lands
    // in the portfolio sync (see submitSwapPendingRef) — no ticket mirror may
    // clear or move it in the meantime.
    if (submitSwapPendingRef.current) {
      return;
    }
    const state = stagedOrderRef.current;
    state.digits =
      instrument?.digits ?? (quote ? quoteDigits(quote.bid, quote.ask) : (instrumentDigitsRef.current ?? 2));
    if (!stagedOnChart) {
      if (state.order !== null || state.currentPrice !== undefined || state.barCloseAt !== undefined) {
        state.order = null;
        state.currentPrice = undefined;
        state.barCloseAt = undefined;
        stagedPrevPriceRef.current = undefined;
        chart.current?.refreshOverlays();
      }
      return;
    }
    const riskPreviewMatchesOrder = Boolean(
      unitsMode !== 'units' &&
      riskPreview &&
      riskPreview.draftVersion === riskVersion.current &&
      riskPreview.symbol === snapshot.symbol &&
      riskPreview.side === riskSide &&
      riskPreview.volume === effectiveVolume &&
      riskPreview.currency === account?.currency,
    );
    const entryPrice = Number(entry);
    const last = snapshot.candles[snapshot.candles.length - 1];
    let current: number | undefined;
    if (quote && Number(quote.last) > 0) {
      current = Number(quote.last);
    } else if (last) {
      current = Number(last.close);
    }
    state.currentPrice = current !== undefined && Number.isFinite(current) && current > 0 ? current : undefined;
    const stopLossNumber = Number(stopLoss);
    const takeProfitNumber = Number(takeProfit);
    const enteredRisk = Number(riskAmount);
    const equity = Number(account?.equity);
    const riskBudget = unitsMode === 'equity' ? (enteredRisk * equity) / 100 : enteredRisk;
    const automaticRiskBudget =
      unitsMode !== 'units' &&
      !volumeManual &&
      riskAmount.trim() !== '' &&
      Number.isFinite(riskBudget) &&
      riskBudget > 0 &&
      Boolean(account?.currency);
    const pendingRiskBudgetLabel =
      automaticRiskBudget && !stopGuard?.slTooClose && account?.currency
        ? formatSignedMoney(-riskBudget, account.currency)
        : undefined;
    const lastBrokerPreview = riskPreviewMatchesOrder ? riskPreview : riskPreviewDisplayRef.current;
    const brokerPreviewMatchesDraft = Boolean(
      automaticRiskBudget &&
      lastBrokerPreview &&
      lastBrokerPreview.symbol === snapshot.symbol &&
      lastBrokerPreview.side === riskSide &&
      lastBrokerPreview.currency === account?.currency &&
      Number.isFinite(Number(lastBrokerPreview.riskBudget)) &&
      Math.abs(Number(lastBrokerPreview.riskBudget) - riskBudget) < 1e-8,
    );
    const previewStopLossMoney =
      brokerPreviewMatchesDraft && lastBrokerPreview
        ? formatSignedMoney(-Number(lastBrokerPreview.estimatedRisk), lastBrokerPreview.currency)
        : pendingRiskBudgetLabel;
    const previewTakeProfitMoney =
      brokerPreviewMatchesDraft && lastBrokerPreview?.estimatedReward
        ? formatSignedMoney(Number(lastBrokerPreview.estimatedReward), lastBrokerPreview.currency)
        : undefined;
    const next: StagedOrderLevels = {
      side: riskSide,
      entry: Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : NaN,
      stopLoss:
        slOn && stopLoss.trim() !== '' && Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
          ? Number(stopLoss)
          : null,
      takeProfit:
        tpOn && takeProfit.trim() !== '' && Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0
          ? Number(takeProfit)
          : null,
      volume: effectiveVolume,
      orderKindLabel:
        orderKind === 'stop_limit' ? 'Stop Limit' : orderKind.charAt(0).toUpperCase() + orderKind.slice(1),
      // Money labels ride on the SAME set-only rule as the levels above.
      slMoney:
        slOn && stopLoss.trim() !== '' && Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
          ? (previewStopLossMoney ?? (automaticRiskBudget ? undefined : levelMoney(stopLossNumber)))
          : undefined,
      tpMoney:
        tpOn && takeProfit.trim() !== '' && Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0
          ? (previewTakeProfitMoney ?? levelMoney(takeProfitNumber))
          : undefined,
      riskRewardLabel:
        slOn && tpOn && stopLoss.trim() !== '' && takeProfit.trim() !== ''
          ? riskRewardRatio(riskSide, orderEntryPrice(orderKind, entry, limitPrice), stopLoss, takeProfit)
          : undefined,
    };
    const previous = state.order;
    const changed =
      !previous ||
      previous.side !== next.side ||
      previous.entry !== next.entry ||
      previous.stopLoss !== next.stopLoss ||
      previous.takeProfit !== next.takeProfit ||
      previous.volume !== next.volume ||
      previous.orderKindLabel !== next.orderKindLabel ||
      previous.slMoney !== next.slMoney ||
      previous.tpMoney !== next.tpMoney ||
      previous.riskRewardLabel !== next.riskRewardLabel;
    state.order = next;
    const priceMoved = stagedPrevPriceRef.current !== state.currentPrice;
    stagedPrevPriceRef.current = state.currentPrice;
    // Levels changed → full repaint; a quote tick alone takes the LIGHT path:
    // setCurrentPrice → scheduleRender (rAF, no container re-measure). The old
    // resize() here re-laid-out the chart on EVERY quote tick while staged.
    if (changed) {
      chart.current?.refreshOverlays();
    } else if (priceMoved && state.currentPrice !== undefined) {
      chart.current?.setCurrentPrice(state.currentPrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stagedOnChart,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    riskSide,
    effectiveVolume,
    riskPreview,
    unitsMode,
    orderKind,
    limitPrice,
    quote,
    snapshot.timeframe,
    snapshot.candles.length,
    instrument?.digits,
    instrument?.contractSize,
    account?.currency,
  ]);
}
