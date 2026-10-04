// P5d split: the order-ticket state, its handlers and the five ticket effects
// move out of App so App stays the composition root. ONE state/handler hook
// (ZERO effects — App calls it where the ticket state used to be declared)
// plus THREE effect-slot hooks, because the ticket effects are INTERLEAVED
// with App-owned effects and registering them as one block would reorder
// App's effect lists:
//   (1) OrderCheck reset [layout] + (3) volume auto-fill [passive] sit between
//       the account-login sync and the favorites/recent persistence effects,
//   (4) entry seed + (5) market follow [passive] sit between the portfolio
//       guard and the bridge-listener effect,
//   (2) risk preview [layout] sits between the timeframe reset and the
//       staged-widget mirror.
// Each group is registered AT its former slot, so both the passive- and the
// layout-effect order stay 1:1 (P5a/P5c pattern). Ticket freshness is mirrored
// into state for rendering; bridge callbacks retain the synchronous ref token.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChartController } from '../chart/engine/chartController';
import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  MarketSnapshot,
  OrderCheckResult,
  OrderKind,
  QuoteSnapshot,
  RiskPreview,
  RiskSide,
  TimeInForce,
} from '../../shared/bridge/types';
import type { StagedOrderState } from '../chart/engine/stagedOrderOverlay';
import { quoteDigits, ticketPrice } from '../../shared/format';
import { deriveOrderTicket, orderEntryPrice } from './ticketRules';

const RISK_PREVIEW_DEBOUNCE_MS = 100;

function defaultStopLossPrice(
  entry: number,
  side: RiskSide,
  orderKind: OrderKind,
  instrument: BrokerSymbol | undefined,
  quote: QuoteSnapshot | undefined,
): string | undefined {
  if (!Number.isFinite(entry) || entry <= 0) {
    return undefined;
  }
  const point = Number(instrument?.pointSize);
  const tick = Number(instrument?.tickSize);
  const known = Number.isFinite(point) && point > 0 && Number.isFinite(tick) && tick > 0;
  const minimum = known ? Math.max((instrument?.stopsLevel ?? 0) * point, 20 * tick) : entry * 0.001;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const hasQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0;
  let reference = entry;
  if (orderKind === 'market' && hasQuote) {
    reference = side === 'buy' ? bid : ask;
  }
  const direction = side === 'buy' ? -1 : 1;
  let digits = instrument?.digits;
  if (digits === undefined) {
    digits = quote ? quoteDigits(quote.bid, quote.ask) : 2;
  }
  const step = known ? Math.max(tick, minimum * 0.25) : minimum * 0.25;
  let distance = known ? minimum + 2 * tick : minimum;
  for (let attempt = 0; attempt < 5; attempt++) {
    const stopLoss = ticketPrice(reference + direction * distance, digits);
    const actual = direction * (Number(stopLoss) - reference);
    if (stopLoss !== '' && Number(stopLoss) > 0 && actual > minimum) {
      return stopLoss;
    }
    distance += step;
  }
  return undefined;
}

/** Everything the ticket reads from App's data/chart layer (P5c param style). */
export type OrderTicketParams = {
  chart: { current: ChartController | null };
  stagedOrderState: { current: StagedOrderState };
  instrumentDigitsRef: { current: number | undefined };
  stagedActiveRef: { current: boolean };
  instrument: BrokerSymbol | undefined;
  account: AccountSnapshot | undefined;
  quote: QuoteSnapshot | undefined;
  snapshot: MarketSnapshot;
  status: BridgeStatus;
};

export function useOrderTicket({
  chart,
  stagedOrderState,
  instrumentDigitsRef,
  stagedActiveRef,
  instrument,
  account,
  quote,
  snapshot,
  status,
}: OrderTicketParams) {
  const stagedOrderRef = stagedOrderState;
  // No-flash fill handover: a SENT order freezes the staged widget in place
  // until the portfolio snapshot carries the fill — the sync repaint then swaps
  // it for the live rows in ONE frame (clear+resize at submit used to flash).
  const submitSwapPendingRef = useRef(false);
  // Last price painted into the axis tag — lets the mirror take the LIGHT
  // repaint path (setCurrentPrice) on quote ticks instead of a full resize().
  const stagedPrevPriceRef = useRef<number | undefined>(undefined);
  const riskVersion = useRef(0);
  const [draftVersion, setDraftVersion] = useState(0);
  const orderCheckGeneration = useRef(0);
  const orderCheckPending = useRef<
    | {
        generation: number;
        draftVersion: number;
        symbol: string;
        accountLogin: string;
        brokerServer: string;
      }
    | undefined
  >(undefined);
  // Units sizing: `units` edits volume directly (manual semantics preserved);
  // money / % equity reuse the risk-preview pipeline and auto-fill + lock Units.
  const unitsAutoMode = useRef<'money' | 'equity'>('money');
  const [riskSide, setRiskSide] = useState<RiskSide>('');
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [riskAmount, setRiskAmount] = useState('');
  const [riskPreview, setRiskPreview] = useState<RiskPreview>();
  // Preserve the last broker quote for chart labels while the next preview is
  // being calculated. The current preview is still cleared for freshness gates.
  const riskPreviewDisplayRef = useRef<RiskPreview | undefined>(undefined);
  const [riskLoading, setRiskLoading] = useState(false);
  const [, setRiskError] = useState<string>();
  const [orderKind, setOrderKind] = useState<OrderKind>('market');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('gtc');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderCheck, setOrderCheck] = useState<OrderCheckResult>();
  const [orderCheckLoading, setOrderCheckLoading] = useState(false);
  const [orderCheckError, setOrderCheckError] = useState<string>();
  const [ticketStage, setTicketStage] = useState<'edit' | 'review'>('edit');
  const [priceMode, setPriceMode] = useState<'offset' | 'absolute'>('absolute');
  const [priceReference, setPriceReference] = useState<'ask' | 'bid' | 'last'>('ask');
  const [priceOffset, setPriceOffset] = useState('0');
  const [unitsMode, setUnitsMode] = useState<'money' | 'equity' | 'units'>('units');
  const [exitsOpen, setExitsOpen] = useState(true);
  const [extraOpen, setExtraOpen] = useState(false);
  const [tpOn, setTpOn] = useState(false);
  const [slOn, setSlOn] = useState(false);
  const [slUnit, setSlUnit] = useState<'ticks' | 'price'>('ticks');
  const [tpUnit, setTpUnit] = useState<'ticks' | 'price'>('ticks');
  const [stagedOnChart, setStagedOnChart] = useState(false);
  const [submittingSide, setSubmittingSide] = useState<RiskSide>();
  // §11 submit outcome for the REVIEW panel (owner: SUCCESS IS SILENT — a sent
  // order closes the review and resets the ticket to its defaults). Only
  // failures carry visible text.
  const [submitStatus, setSubmitStatus] = useState<{ kind: 'locked' | 'error'; text: string }>();
  // §11 editable Volume: the field's text value and its mode (manual sticks until the field is cleared).
  // micro-list #2: Units defaults to '1' at ticket init (auto-sizing overwrites it once it computes).
  const [orderVolume, setOrderVolume] = useState('1');
  const [volumeManual, setVolumeManual] = useState(false);
  // P1 FIELD-SOURCE: the ticket fields are canonical for check/submit args; the
  // risk preview is an ENHANCEMENT (volume auto-sizing + RR/risk estimates +
  // freshness sanity). SL-off ⇒ stopLoss arg is null (backend a58ad9e).
  const {
    orderCheckEntry,
    orderCheckStopLoss,
    orderCheckTakeProfit,
    normalizedLimitPrice,
    limitPriceValid,
    orderKindDisplay,
    effectiveVolume,
    volumeIssue,
    stopGuard,
    canCheckOrder,
    canSubmitOrder,
    ticketBlockedReason,
  } = deriveOrderTicket({
    symbol: snapshot.symbol,
    bridgeState: status.state,
    account,
    stagedOnChart,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    orderKind,
    limitPrice,
    timeInForce,
    unitsMode,
    orderVolume,
    orderCheck,
    riskPreview,
    draftVersion,
    riskLoading,
    instrument,
    quote,
    marketOpen: status.marketSession?.isOpen,
  });
  // Handler-side subset of the TV ticket derivations (App keeps the
  // presentation-only ones: pointSize/spread/tick value/limit-price badge —
  // they read the same tickSize/tickKnown returned below).
  const tickSize = instrument ? Number(instrument.tickSize) : NaN;
  const tickKnown = Number.isFinite(tickSize) && tickSize > 0;
  const priceSwapDisabled = priceMode === 'absolute' && (orderKind === 'market' || !quote || !tickKnown);
  const requestOrderCheck = async () => {
    if (!canCheckOrder || !snapshot.symbol || !account || orderCheckEntry === null) {
      return;
    }
    // With SL off there is no preview; riskVersion still bumps on every field
    // edit, so it remains a valid freshness token for the echo-match below.
    const draftVersion = riskPreview?.draftVersion ?? riskVersion.current;
    const generation = ++orderCheckGeneration.current;
    const pending = { generation, draftVersion, symbol: snapshot.symbol, accountLogin: account.accountLogin };
    orderCheckPending.current = { ...pending, brokerServer: account.brokerServer };
    setOrderCheck(undefined);
    setOrderCheckError(undefined);
    setOrderCheckLoading(true);
    try {
      await invoke('request_order_check', {
        accountLogin: account.accountLogin,
        brokerServer: account.brokerServer,
        symbol: snapshot.symbol,
        side: riskSide,
        orderKind,
        volume: effectiveVolume,
        entry: orderCheckEntry,
        stopLoss: slOn ? orderCheckStopLoss : null,
        takeProfit: tpOn ? orderCheckTakeProfit : null,
        timeInForce,
        limitPrice: normalizedLimitPrice,
        draftVersion,
      });
    } catch (error) {
      if (orderCheckPending.current?.generation === generation) {
        orderCheckPending.current = undefined;
        setOrderCheckLoading(false);
        setOrderCheckError('OrderCheck could not be requested.');
      }
      console.info('MT5 OrderCheck unavailable.', error);
    }
  };
  // §11: sends only what the accepted OrderCheck validated. The dispatch gate is
  // owner-unlocked; a success is SILENT and CLOSES the review — the ticket
  // resets to its defaults (owner: no confirmation message), a dispatch-
  // disabled rejection shows the calm locked message and any other error shows
  // its own text verbatim.
  const submitOrder = async (side: RiskSide) => {
    const check = orderCheck;
    const currentAccount = account;
    if (!canSubmitOrder || !check?.draftId || !currentAccount || orderCheckEntry === null || submittingSide) {
      return;
    }
    setSubmittingSide(side);
    console.info(`[submit-order] ${JSON.stringify({ side, symbol: snapshot.symbol, orderKind })}`);
    try {
      await invoke('submit_order', {
        draftId: check.draftId,
        accountLogin: currentAccount.accountLogin,
        brokerServer: currentAccount.brokerServer,
        symbol: snapshot.symbol,
        side,
        orderKind,
        volume: effectiveVolume,
        entry: orderCheckEntry,
        stopLoss: slOn ? orderCheckStopLoss : null,
        takeProfit: tpOn ? orderCheckTakeProfit : null,
        timeInForce,
        limitPrice: normalizedLimitPrice,
      });
      // Owner: a SENT order completes the draft — close the review and reset
      // the ticket to its defaults (no confirmation copy). NO chart repaint
      // here: the staged widget stays FROZEN on the chart until the portfolio
      // snapshot carries the fill, and the sync repaint swaps it for the live
      // rows in ONE frame (the old clear+resize double repaint flashed).
      submitSwapPendingRef.current = true;
      setStagedOnChart(false);
      resetTicketToDefaults();
      console.info(`[submit-order] submitted ${side} ${snapshot.symbol}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.info(`[submit-order] rejected ${text}`);
      setSubmitStatus(
        /dispatch is disabled/i.test(text)
          ? { kind: 'locked', text: 'Dispatch locked — nothing was sent to MT5. Owner approval required.' }
          : { kind: 'error', text },
      );
    } finally {
      setSubmittingSide(undefined);
    }
  };
  // Single unstage path: clears levels AND the axis-tag fields (price /
  // barCloseAt) so no frozen "price / mm:ss" tag survives ✕ / submit /
  // symbol-change — then repaints once to erase the last frame.
  const clearStagedWidget = () => {
    const s = stagedOrderRef.current;
    const had = s.order !== null || s.currentPrice !== undefined || s.barCloseAt !== undefined;
    s.order = null;
    s.currentPrice = undefined;
    s.barCloseAt = undefined;
    stagedPrevPriceRef.current = undefined;
    if (had) {
      chart.current?.refreshOverlays();
    }
    setStagedOnChart(false);
    return had;
  };
  // A fresh draft has NO levels and no entry anchor (owner): SL/TP toggles +
  // values and the price are cleared, the market entry reseeds from the live
  // quote via the [quote] effect right after clearing.
  const resetOrderDraft = () => {
    setSlOn(false);
    setTpOn(false);
    setStopLoss('');
    setTakeProfit('');
    setEntry('');
  };
  // Owner: a SENT order resets the whole ticket to its init defaults (the
  // review closes with it). The side stays as selected — it is a mode, not a
  // value.
  const resetTicketToDefaults = () => {
    resetOrderDraft();
    setRiskAmount('');
    setOrderKind('market');
    setLimitPrice('');
    setTimeInForce('gtc');
    setUnitsMode('units');
    setOrderVolume('1');
    setVolumeManual(false);
    setSlUnit('ticks');
    setTpUnit('ticks');
    setPriceMode('absolute');
    setPriceReference('ask');
    setPriceOffset('0');
    setTicketStage('edit');
  };
  const enableRiskStopLoss = (side: RiskSide, entryPrice: number, overwrite = false) => {
    setSlOn(true);
    if (overwrite || !stopLoss.trim()) {
      const defaultStop = defaultStopLossPrice(entryPrice, side, orderKind, instrument, quote);
      if (defaultStop) {
        setStopLoss(defaultStop);
      }
    }
  };
  const stageOrderDraft = (side: RiskSide, fresh = false) => {
    submitSwapPendingRef.current = false;
    if (snapshot.candles.length === 0) {
      return;
    } // side selected; nothing to anchor the widget to
    const digits = instrumentDigitsRef.current;
    // `fresh` = the caller just reset the draft: never anchor the widget on the
    // stale entry still sitting in this render closure.
    let price = fresh ? NaN : Number(entry);
    if (!Number.isFinite(price) || price <= 0) {
      const fallback = quote
        ? Number(side === 'buy' ? quote.ask : quote.bid)
        : Number(snapshot.candles[snapshot.candles.length - 1]?.close);
      if (!Number.isFinite(fallback) || fallback <= 0) {
        return;
      } // side selected, widget stays unstaged
      price = fallback;
      setEntry(ticketPrice(price, digits));
    }
    if (!orderVolume.trim()) {
      setOrderVolume('1');
    } // micro-list #2: empty Units → '1' on staging
    if (unitsMode !== 'units' && Number(riskAmount) > 0 && (!stagedOnChart || fresh)) {
      enableRiskStopLoss(side, price, fresh);
    }
    setStagedOnChart(true);
  };
  const setRiskAmountFromInput = (value: string) => {
    setRiskAmount(value);
    if (stagedOnChart && unitsMode !== 'units' && Number(value) > 0) {
      enableRiskStopLoss(riskSide, Number(orderEntryPrice(orderKind, entry, limitPrice)));
    }
  };
  // (✕)/Esc abandons the staged order: besides the widget, suppress the
  // ticket-driven Draft … lines too (they would repaint from the kept field
  // values) until the next field edit re-arms them — same suppress-until-edit
  // rule as a successful submit. Only an ACTUAL staged widget arms this.
  // CANCEL RESETS THE DRAFT (owner) — see resetOrderDraft.
  const unstageOrderDraft = () => {
    const wasStaged = stagedActiveRef.current;
    submitSwapPendingRef.current = false;
    clearStagedWidget();
    if (wasStaged) {
      resetOrderDraft();
    }
  };
  // Quote-row side buttons: SWITCHING sides starts a fresh draft (owner) — the
  // other side's SL/TP levels and entry anchor must not leak into it. Re-pressing
  // the already-active side just re-stages with the current values.
  const stageFromQuote = (side: RiskSide) => {
    const switched = riskSide !== side;
    if (switched) {
      resetOrderDraft();
    }
    setRiskSide(side);
    stageOrderDraft(side, switched);
  };
  const togglePriceMode = () => {
    if (priceSwapDisabled) {
      return;
    }
    setPriceMode(priceMode === 'absolute' ? 'offset' : 'absolute');
  };
  const priceToTicks = (price: string, _kind: 'sl' | 'tp'): string => {
    if (!tickKnown) {
      return '';
    }
    const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(base) || base <= 0 || !Number.isFinite(value) || value <= 0) {
      return '';
    }
    return String(Math.round(Math.abs(value - base) / tickSize));
  };
  const ticksToPrice = (text: string, kind: 'sl' | 'tp'): string | null => {
    if (!tickKnown) {
      return null;
    }
    const base = Number(orderEntryPrice(orderKind, entry, limitPrice));
    const ticks = Number(text);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(ticks) || ticks < 0) {
      return null;
    }
    let direction: number;
    if (kind === 'sl') {
      direction = riskSide === 'buy' ? -1 : 1;
    } else {
      direction = riskSide === 'buy' ? 1 : -1;
    }
    const price = base + direction * ticks * tickSize;
    if (!(price > 0)) {
      return null;
    }
    return String(Number(price.toFixed(instrument?.digits ?? 2)));
  };
  const applyExitTicks = (kind: 'sl' | 'tp', text: string) => {
    if (text.trim() === '') {
      if (kind === 'sl') {
        setStopLoss('');
      } else {
        setTakeProfit('');
      }
      return;
    }
    const price = ticksToPrice(text, kind);
    if (price === null) {
      return;
    }
    if (kind === 'sl') {
      setStopLoss(price);
    } else {
      setTakeProfit(price);
    }
  };
  const swapExitUnit = (kind: 'sl' | 'tp') => {
    if (!tickKnown) {
      return;
    }
    if (kind === 'sl') {
      setSlUnit(slUnit === 'ticks' ? 'price' : 'ticks');
    } else {
      setTpUnit(tpUnit === 'ticks' ? 'price' : 'ticks');
    }
  };
  // TV semantics: toggling an exit OFF greys the row but keeps its value — the
  // level is simply excluded from risk-preview/OrderCheck/submit while off.
  const toggleExit = (kind: 'sl' | 'tp', on: boolean) => {
    if (kind === 'sl') {
      setSlOn(on);
    } else {
      setTpOn(on);
    }
  };
  const applyUnitsMode = (mode: 'money' | 'equity' | 'units') => {
    if (mode !== unitsMode) {
      // Every sizing-mode change starts a fresh sizing draft. In particular,
      // changing the risk basis must not carry an amount or exits from the
      // previous basis into the new one.
      setOrderVolume('1');
      setVolumeManual(false);
      setRiskAmount('');
      setSlOn(false);
      setTpOn(false);
      setStopLoss('');
      setTakeProfit('');
    }
    if (mode !== 'units') {
      unitsAutoMode.current = mode;
    }
    setUnitsMode(mode);
    if (mode === 'units') {
      /* auto-fill stays live until the user types (onChange sets manual) */
    }
    // A manually-set volume is NEVER overwritten (owner: "po co zmienia units
    // skoro jest 1") — auto volumes follow the preview as before.
    // The next valid risk preview will auto-fill the reset Units value.
  };
  const startOrderReview = () => {
    if (!canCheckOrder || orderCheckLoading) {
      return;
    }
    setSubmitStatus(undefined);
    setTicketStage('review');
    void requestOrderCheck();
  };
  return {
    // App data context echoed for the effect-slot hooks below (same identities;
    // their frozen dep arrays reference these names).
    snapshot,
    status,
    account,
    quote,
    // state
    riskSide,
    setRiskSide,
    entry,
    setEntry,
    stopLoss,
    setStopLoss,
    takeProfit,
    setTakeProfit,
    riskAmount,
    setRiskAmount,
    setRiskAmountFromInput,
    riskPreview,
    setRiskPreview,
    riskPreviewDisplayRef,
    riskLoading,
    setRiskLoading,
    setRiskError,
    orderKind,
    setOrderKind,
    timeInForce,
    setTimeInForce,
    limitPrice,
    setLimitPrice,
    orderCheck,
    setOrderCheck,
    orderCheckLoading,
    setOrderCheckLoading,
    orderCheckError,
    setOrderCheckError,
    ticketStage,
    setTicketStage,
    priceMode,
    setPriceMode,
    priceReference,
    setPriceReference,
    priceOffset,
    setPriceOffset,
    unitsMode,
    setUnitsMode,
    exitsOpen,
    setExitsOpen,
    extraOpen,
    setExtraOpen,
    tpOn,
    setTpOn,
    slOn,
    setSlOn,
    slUnit,
    setSlUnit,
    tpUnit,
    setTpUnit,
    stagedOnChart,
    setStagedOnChart,
    orderVolume,
    setOrderVolume,
    volumeManual,
    setVolumeManual,
    submittingSide,
    setSubmittingSide,
    submitStatus,
    setSubmitStatus,
    submitSwapPendingRef,
    stagedPrevPriceRef,
    riskVersion,
    setDraftVersion,
    orderCheckGeneration,
    orderCheckPending,
    unitsAutoMode,
    // handlers
    priceToTicks,
    ticksToPrice,
    applyExitTicks,
    swapExitUnit,
    toggleExit,
    togglePriceMode,
    applyUnitsMode,
    resetOrderDraft,
    resetTicketToDefaults,
    stageOrderDraft,
    unstageOrderDraft,
    stageFromQuote,
    clearStagedWidget,
    startOrderReview,
    requestOrderCheck,
    submitOrder,
    // deriveOrderTicket outputs
    orderCheckEntry,
    orderCheckStopLoss,
    orderCheckTakeProfit,
    normalizedLimitPrice,
    limitPriceValid,
    orderKindDisplay,
    effectiveVolume,
    volumeIssue,
    stopGuard,
    canCheckOrder,
    canSubmitOrder,
    ticketBlockedReason,
    // handler-side ticket derivations
    tickSize,
    tickKnown,
    priceSwapDisabled,
  };
}

export type OrderTicketState = ReturnType<typeof useOrderTicket>;

// Effect slots (1) + (3): the OrderCheck reset [layout] and the §11 volume
// auto-fill [passive] register together at their former App slot — after the
// account-login sync, before the favorites/recent persistence effects — so
// both effect lists stay 1:1. Dep arrays frozen (identical expressions,
// identical position order to the former inline effects in App).
export function useOrderTicketOrderCheckEffects(ticket: OrderTicketState): void {
  const {
    snapshot,
    status,
    account,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckError,
    setOrderCheckLoading,
    setSubmitStatus,
    setTicketStage,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    riskAmount,
    orderKind,
    slOn,
    tpOn,
    limitPrice,
    timeInForce,
    unitsMode,
    volumeManual,
    riskPreview,
    setOrderVolume,
    riskVersion,
    setStopLoss,
  } = ticket;
  const orderCheckGenerationRef = orderCheckGeneration;
  const orderCheckPendingRef = orderCheckPending;
  useLayoutEffect(() => {
    orderCheckGenerationRef.current += 1;
    orderCheckPendingRef.current = undefined;
    setOrderCheck(undefined);
    setOrderCheckError(undefined);
    setOrderCheckLoading(false);
    setSubmitStatus(undefined);
    setTicketStage('edit');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: refs/setters come from the hook return (stable identities); dep array frozen 1:1 with the former inline effect
  }, [
    snapshot.symbol,
    snapshot.timeframe,
    account?.accountLogin,
    account?.brokerServer,
    account?.currency,
    status.state,
    riskSide,
    entry,
    stopLoss,
    takeProfit,
    riskAmount,
    orderKind,
    slOn,
    tpOn,
    limitPrice,
    timeInForce,
    unitsMode,
  ]);
  // §11 volume auto-sync: mirror each NEW risk-sizing volume while the user has not
  // overridden the field. Deps track only the preview on purpose — re-running on
  // volumeManual would instantly refill a just-cleared field instead of letting the
  // user type a fresh volume (clearing is what returns the field to auto mode).
  useEffect(() => {
    if (
      riskPreview &&
      riskPreview.draftVersion === riskVersion.current &&
      riskPreview.symbol === snapshot.symbol &&
      riskPreview.side === riskSide &&
      slOn &&
      riskPreview.stopLoss !== stopLoss
    ) {
      // MT5 normalizes SL to the instrument's tick grid. Make that broker
      // value canonical so the ticket and chart do not alternate between the
      // typed level and the returned level.
      setStopLoss(riskPreview.stopLoss);
    }
    if (!volumeManual && riskPreview !== undefined) {
      setOrderVolume(riskPreview.volume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskPreview]);
}

// Effect slots (4) + (5): entry reseed from the live quote and the market
// follow — registered at their former slot between the portfolio guard and the
// bridge-listener effect.
export function useOrderTicketEntryEffects(ticket: OrderTicketState): void {
  const previousMarketSelection = useRef<{ orderKind: OrderKind; riskSide: RiskSide } | undefined>(undefined);
  const {
    quote,
    riskSide,
    entry,
    setEntry,
    orderKind,
    stagedOnChart,
    ticketStage,
    stopLoss,
    takeProfit,
    slOn,
    tpOn,
    setStopLoss,
    setTakeProfit,
  } = ticket;
  useEffect(() => {
    if (quote && !entry) {
      setEntry(riskSide === 'buy' ? quote.ask : quote.bid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- P5d: hook-provided setter, stable identity (P5a pattern); dep array frozen 1:1
  }, [quote, riskSide, entry]);
  // A staged market order follows quote ticks while it is being edited.
  // Translate enabled exits by the same delta to preserve their distances.
  useEffect(() => {
    const selectionChanged =
      previousMarketSelection.current !== undefined &&
      (previousMarketSelection.current.orderKind !== orderKind ||
        previousMarketSelection.current.riskSide !== riskSide);
    previousMarketSelection.current = { orderKind, riskSide };
    if (orderKind !== 'market' || !quote) {
      return;
    }
    const nextEntryText = riskSide === 'buy' ? quote.ask : quote.bid;
    const nextEntry = Number(nextEntryText);
    if (!Number.isFinite(nextEntry) || nextEntry <= 0) {
      return;
    }
    if (!stagedOnChart || ticketStage !== 'edit') {
      if (selectionChanged) {
        setEntry(nextEntryText);
      }
      return;
    }

    const previousEntry = Number(entry);
    if (!Number.isFinite(previousEntry) || previousEntry <= 0) {
      setEntry(nextEntryText);
      return;
    }
    const delta = nextEntry - previousEntry;
    if (delta === 0) {
      return;
    }
    const digits = quoteDigits(quote.bid, quote.ask);
    const shiftLevel = (value: string, enabled: boolean, update: (next: string) => void) => {
      if (!enabled || !value.trim()) {
        return;
      }
      const level = Number(value);
      if (Number.isFinite(level) && level > 0) {
        update(ticketPrice(level + delta, digits));
      }
    };
    shiftLevel(stopLoss, slOn, setStopLoss);
    shiftLevel(takeProfit, tpOn, setTakeProfit);
    setEntry(nextEntryText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; this mirrors live market ticks only while a staged draft is editable
  }, [orderKind, riskSide, quote, stagedOnChart, ticketStage, entry, stopLoss, takeProfit, slOn, tpOn]);
}

// Effect slot (2): the debounced risk-preview request [layout] — registered at
// its former slot between the timeframe reset and the staged-widget mirror.
// `riskMode`/`effectiveRiskAmount` are App's §10 risk-basis derivations (they
// feed the display too), passed in as the effect's external inputs.
export function useOrderTicketRiskPreviewEffects(
  ticket: OrderTicketState,
  { riskMode, effectiveRiskAmount }: { riskMode: 'usd' | 'equity'; effectiveRiskAmount: string },
): void {
  const {
    snapshot,
    status,
    account,
    riskSide,
    entry,
    orderKind,
    limitPrice,
    stopLoss,
    takeProfit,
    riskAmount,
    slOn,
    tpOn,
    stopGuard,
    riskVersion,
    setDraftVersion,
    setRiskPreview,
    setRiskError,
    setRiskLoading,
  } = ticket;
  const riskVersionRef = riskVersion;
  const sizingEntry = orderEntryPrice(orderKind, entry, limitPrice);
  const equity = riskMode === 'equity' && account?.equity;
  useLayoutEffect(() => {
    const version = ++riskVersionRef.current;
    // Update the rendered freshness gate before paint, including the no-SL path.
    setDraftVersion(version);
    const symbol = snapshot.symbol;
    setRiskPreview(undefined);
    setRiskError(undefined);
    setRiskLoading(false);
    // Sizing NEVER derives from an invalid stop distance (owner: "not less than
    // the minimum required SL") — with the stop too close/crossed the preview
    // math is garbage and must not touch the units ("why change units when it
    // is 1"). The guard mirrors the EA preflight (distance > max(stopsLevel ×
    // pointSize, 20 × tickSize), with the reference selected by order kind).
    const valid = Boolean(
      symbol &&
      account?.accountLogin &&
      account.currency &&
      status.state === 'connected' &&
      sizingEntry.trim() &&
      slOn &&
      stopLoss.trim() &&
      effectiveRiskAmount.trim() &&
      Number.isFinite(Number(sizingEntry)) &&
      Number(sizingEntry) > 0 &&
      Number.isFinite(Number(stopLoss)) &&
      Number(effectiveRiskAmount) > 0 &&
      !stopGuard?.slTooClose &&
      !stopGuard?.tpTooClose,
    );
    if (!valid || !symbol || !account?.accountLogin || !account.currency) {
      return;
    }
    setRiskLoading(true);
    const timer = window.setTimeout(() => {
      void invoke('request_risk_preview', {
        symbol,
        side: riskSide,
        entry: sizingEntry,
        stopLoss: slOn ? stopLoss : '',
        takeProfit: tpOn && takeProfit.trim() ? takeProfit.trim() : null,
        riskAmount: effectiveRiskAmount,
        draftVersion: version,
      }).catch((error) => {
        if (version === riskVersionRef.current) {
          setRiskLoading(false);
          setRiskError('Risk preview is unavailable.');
        }
        console.info('Risk preview unavailable.', error);
      });
    }, RISK_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    snapshot.symbol,
    snapshot.timeframe,
    status.state,
    account?.accountLogin,
    account?.brokerServer,
    account?.currency,
    riskSide,
    entry,
    orderKind,
    limitPrice,
    sizingEntry,
    stopLoss,
    takeProfit,
    riskAmount,
    riskMode,
    slOn,
    tpOn,
    effectiveRiskAmount,
    stopGuard?.slTooClose,
    stopGuard?.tpTooClose,
    equity,
    riskVersionRef,
    setDraftVersion,
    setRiskPreview,
    setRiskError,
    setRiskLoading,
  ]);
}
