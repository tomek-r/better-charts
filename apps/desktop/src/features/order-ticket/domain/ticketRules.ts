import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  OrderCheckResult,
  OrderKind,
  QuoteSnapshot,
  RiskPreview,
  RiskSide,
  TimeInForce,
} from '../../../shared/bridge/types';
import { normalizedPrice } from '../../../shared/format';

// Editable volume: positive decimal and — when instrument metadata is known — inside [volumeMin, volumeMax] and a whole multiple of volumeStep (the 1e-8 tolerance absorbs binary-float noise such as 0.3/0.1). Unknown instrument: plain positive decimal only; the backend/EA re-validates volume on the wire.
export function orderVolumeIssue(value: string, instrument?: BrokerSymbol): string | undefined {
  const trimmed = value.trim();
  const volume = Number(trimmed);
  if (!trimmed || !Number.isFinite(volume) || volume <= 0) {
    return 'Volume must be a positive decimal.';
  }
  if (!instrument) {
    return undefined;
  }
  const min = Number(instrument.volumeMin);
  const max = Number(instrument.volumeMax);
  const step = Number(instrument.volumeStep);
  const range = `Volume must be between ${instrument.volumeMin} and ${instrument.volumeMax}.`;
  if (Number.isFinite(min) && volume < min) {
    return range;
  }
  if (Number.isFinite(max) && volume > max) {
    return range;
  }
  if (Number.isFinite(step) && step > 0 && Math.abs(volume / step - Math.round(volume / step)) > 1e-8) {
    return `Volume must respect ${instrument.volumeStep} step (min ${instrument.volumeMin}, max ${instrument.volumeMax})`;
  }
  return undefined;
}
// stop-distance guard: a check/submit guard that
// mirrors the EA/Rust preflight — required distance = max(stopsLevel × pointSize,
// 20 × tickSize) in price units, rendered in points (price / pointSize).
// Market levels are measured from live quote sides (BUY: SL vs bid, TP vs ask;
// SELL mirrored). Pending levels use their executable entry reference, and
// stop_limit uses its resting limit price rather than its trigger. A distance
// at or below the minimum violates the EA's strict
// "distance > min" requirement; unknown/invalid instrument sizes disable the guard.
export type StopDistanceGuard = {
  slTooClose: boolean;
  tpTooClose: boolean;
  reason?: string;
};

/** Price used for entry-relative risk sizing: stop_limit executes from its resting price. */
export function orderEntryPrice(orderKind: OrderKind, entry: string, limitPrice: string): string {
  return orderKind === 'stop_limit' ? limitPrice : entry;
}

/** Prefer broker account-currency estimates; price distances are a fallback. */
export function riskRewardRatio(
  side: RiskSide,
  entry: string | number,
  stopLoss: string | number,
  takeProfit: string | number,
  estimate?: Pick<RiskPreview, 'estimatedRisk' | 'estimatedReward'>,
): string | undefined {
  const entryPrice = Number(entry);
  const stopPrice = Number(stopLoss);
  const targetPrice = Number(takeProfit);
  if (![entryPrice, stopPrice, targetPrice].every((price) => Number.isFinite(price) && price > 0)) {
    return undefined;
  }
  const risk = side === 'buy' ? entryPrice - stopPrice : stopPrice - entryPrice;
  const reward = side === 'buy' ? targetPrice - entryPrice : entryPrice - targetPrice;
  if (risk <= 0 || reward <= 0) {
    return undefined;
  }
  if (estimate?.estimatedReward != null) {
    const estimatedRisk = Number(estimate.estimatedRisk);
    const estimatedReward = Number(estimate.estimatedReward);
    if (
      Number.isFinite(estimatedRisk) &&
      estimatedRisk > 0 &&
      Number.isFinite(estimatedReward) &&
      estimatedReward >= 0
    ) {
      return (estimatedReward / estimatedRisk).toFixed(2);
    }
  }
  return (reward / risk).toFixed(2);
}

export function stopDistanceGuard(
  instrument: BrokerSymbol | undefined,
  side: RiskSide,
  entry: string,
  stopLoss: string,
  takeProfit: string,
  quote: QuoteSnapshot | undefined,
  orderKind: OrderKind = 'market',
  limitPrice = '',
): StopDistanceGuard | undefined {
  if (!instrument) {
    return undefined;
  }
  const point = Number(instrument.pointSize);
  const tick = Number(instrument.tickSize);
  if (!Number.isFinite(point) || point <= 0 || !Number.isFinite(tick) || tick <= 0) {
    return undefined;
  }
  const minimum = Math.max(instrument.stopsLevel * point, 20 * tick);
  const minimumPoints = Math.round(minimum / point);
  const buy = side === 'buy';
  const entryValue = Number(entry.trim());
  const stopValue = Number(stopLoss.trim());
  const takeText = takeProfit.trim();
  const takeValue = Number(takeText);
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const hasQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0;
  const referenceText = orderEntryPrice(orderKind, entry, limitPrice).trim();
  const reference = Number(referenceText);
  const hasReference = referenceText !== '' && Number.isFinite(reference) && reference > 0;
  const useQuote = orderKind === 'market' && hasQuote;
  let slReference = reference;
  let tpReference = reference;
  if (useQuote) {
    slReference = buy ? bid : ask;
    tpReference = buy ? ask : bid;
  }
  const hasEntry = entry.trim() !== '' && Number.isFinite(entryValue) && entryValue > 0;
  const hasStop = stopLoss.trim() !== '' && Number.isFinite(stopValue) && stopValue > 0;
  const hasTake = takeText !== '' && Number.isFinite(takeValue) && takeValue > 0;
  let slDistance: number | undefined;
  if (hasReference && hasEntry && hasStop) {
    slDistance = buy ? slReference - stopValue : stopValue - slReference;
  }
  let tpDistance: number | undefined;
  if (hasReference && hasEntry && hasTake) {
    tpDistance = buy ? takeValue - tpReference : tpReference - takeValue;
  }
  const isTooClose = (distance: number | undefined, reference: number, level: number): boolean => {
    if (distance === undefined) {
      return false;
    }
    // Decimal prices such as 98.20 - 98 can land a few ULPs above 0.20.
    // Keep the strict `distance > minimum` contract stable at that boundary.
    const tolerance = Number.EPSILON * Math.max(Math.abs(reference), Math.abs(level), Math.abs(minimum), 1) * 4;
    return distance <= minimum + tolerance;
  };
  const slTooClose = isTooClose(slDistance, slReference, stopValue);
  const tpTooClose = isTooClose(tpDistance, tpReference, takeValue);
  const points = (distance: number) => Math.round(distance / point);
  let reason: string | undefined;
  if (slTooClose && slDistance !== undefined) {
    reason = `stop_loss too close: distance ${points(slDistance)} pts, required >= ${minimumPoints} pts (20 ticks margin)`;
  } else if (tpTooClose && tpDistance !== undefined) {
    reason = `take_profit too close: distance ${points(tpDistance)} pts, required >= ${minimumPoints} pts (20 ticks margin)`;
  }
  return { slTooClose, tpTooClose, reason };
}

// Numeric echo comparison: the OrderCheck result must match the ticket fields
// regardless of decimal formatting; null must stay null.
const samePrice = (echo: string | null | undefined, field: string | null): boolean =>
  field === null
    ? echo === null || echo === undefined
    : echo !== null && echo !== undefined && Number(echo) === Number(field);

export function equityAllocationIssue(value: string): string | undefined {
  const percent = Number(value);
  return value.trim() && Number.isFinite(percent) && percent > 0 && percent <= 100
    ? undefined
    : 'Equity allocation must be greater than 0 and at most 100%.';
}

export type TicketDerivationInput = {
  symbol: string | undefined;
  bridgeState: BridgeStatus['state'];
  account: Partial<Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'>> | undefined;
  stagedOnChart: boolean;
  riskSide: RiskSide;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  slOn: boolean;
  tpOn: boolean;
  orderKind: OrderKind;
  limitPrice: string;
  timeInForce: TimeInForce;
  unitsMode: 'money' | 'equity' | 'units';
  equityAllocationPercent?: string;
  orderVolume: string;
  orderCheck: OrderCheckResult | undefined;
  riskPreview: RiskPreview | undefined;
  draftVersion: number;
  riskLoading: boolean;
  instrument: BrokerSymbol | undefined;
  quote: QuoteSnapshot | undefined;
  marketOpen: boolean | undefined;
};

export type TicketDerivation = {
  orderCheckEntry: string | null;
  orderCheckStopLoss: string | null;
  orderCheckTakeProfit: string | null;
  normalizedLimitPrice: string | null;
  limitPriceValid: boolean;
  sizingAllowed: boolean;
  previewRequired: boolean;
  orderKindDisplay: string;
  effectiveVolume: string;
  volumeIssue: string | undefined;
  orderVolumeValid: boolean;
  stopGuard: StopDistanceGuard | undefined;
  canCheckOrder: boolean;
  canSubmitOrder: boolean;
  ticketBlockedReason: string | undefined;
};

// Derive ticket gates from App state. The ordered blocked-reason chain is
// observable policy; overlapping failures retain their precedence, and `''`
// is a distinct reason value.
export function deriveOrderTicket(input: TicketDerivationInput): TicketDerivation {
  const orderCheckEntry = normalizedPrice(input.entry);
  const orderCheckStopLoss = input.slOn ? normalizedPrice(input.stopLoss) : null;
  const orderCheckTakeProfit = input.tpOn && input.takeProfit.trim() !== '' ? normalizedPrice(input.takeProfit) : null;
  // stop_limit's resting price — REQUIRED iff kind = stop_limit (backend
  // rejects "stop_limit requires limit_price"); null otherwise (sent as null,
  // which deserializes to None).
  const normalizedLimitPrice = input.orderKind === 'stop_limit' ? normalizedPrice(input.limitPrice) : null;
  const limitPriceValid =
    input.orderKind !== 'stop_limit' ||
    (input.limitPrice.trim() !== '' && Number.isFinite(Number(input.limitPrice)) && Number(input.limitPrice) > 0);
  // SL-off is only allowed with manual units sizing — money/% sizing needs the
  // stop distance for its risk math. Choosing risk sizing leaves the SL toggle
  // under the user's control; the gate blocks review until a stop is enabled.
  const sizingAllowed = input.slOn || input.unitsMode === 'units';
  // The risk preview (which itself REQUIRES a risk budget) is needed only for
  // money/% auto-sizing with a stop distance. Manual units volume runs the
  // chain on the OrderCheck echo alone — the risk budget is then optional
  // (estimates only), per owner: "if I typed units it must not require risk".
  const previewRequired = input.slOn && input.unitsMode !== 'units';
  const orderKindDisplay = input.orderKind === 'stop_limit' ? 'Stop Limit' : input.orderKind;
  // Effective volume = what both flows send: the field's value (auto mode mirrors risk sizing, manual mode is the user's typed override).
  const effectiveVolume = input.orderVolume.trim();
  const volumeIssue = effectiveVolume === '' ? undefined : orderVolumeIssue(effectiveVolume, input.instrument);
  const orderVolumeValid = effectiveVolume !== '' && volumeIssue === undefined;
  const stopGuard = stopDistanceGuard(
    input.instrument,
    input.riskSide,
    input.entry,
    input.slOn ? input.stopLoss : '',
    input.tpOn ? input.takeProfit : '',
    input.quote,
    input.orderKind,
    input.limitPrice,
  );
  // Preview chain stays REQUIRED only for money/% auto-sizing (see
  // previewRequired); the manual-units and no-SL paths run on the OrderCheck
  // echo + field freshness (draftVersion === riskVersion.current, bumped by
  // every field edit) instead. An enabled SL must still carry a price.
  // Owner flow: nothing is checkable until a staged order exists (Buy/Sell click
  // stages; (✕)/Esc/unstage disarm the ticket again).
  const allocationIssue =
    input.unitsMode === 'units' ? undefined : equityAllocationIssue(input.equityAllocationPercent ?? '100');
  const bridgeConnected = input.bridgeState === 'connected';
  const accountAvailable = Boolean(input.account?.accountLogin && input.account.brokerServer);
  const stopDistanceAllowed = stopGuard?.reason === undefined;
  const stopDistanceReason = stopGuard?.reason;
  const currentPreviewMatchesDraft = Boolean(
    input.riskPreview &&
    input.riskPreview.draftVersion === input.draftVersion &&
    input.riskPreview.symbol === input.symbol &&
    input.riskPreview.side === input.riskSide,
  );
  // A market draft follows quote ticks, so review may run while its preview refetches.
  const previewReadyForCheck = !previewRequired || input.orderKind === 'market' || currentPreviewMatchesDraft;
  const acceptedCurrentCheck = Boolean(
    input.orderCheck?.checkPassed && input.orderCheck.draftId && input.orderCheck.draftVersion === input.draftVersion,
  );
  const previewCurrentForSubmit = Boolean(
    currentPreviewMatchesDraft && input.riskPreview?.draftVersion === input.orderCheck?.draftVersion,
  );
  const orderCheckVolumeMatches = input.orderCheck?.volume === effectiveVolume;
  const orderCheckAccountMatches = Boolean(
    input.orderCheck &&
    input.orderCheck.accountLogin === input.account?.accountLogin &&
    input.orderCheck.brokerServer === input.account?.brokerServer,
  );
  const orderCheckIdentityMatches = Boolean(
    input.orderCheck &&
    input.orderCheck.orderKind === input.orderKind &&
    input.orderCheck.symbol === input.symbol &&
    input.orderCheck.side === input.riskSide,
  );
  const orderCheckPricesMatch = Boolean(
    input.orderCheck &&
    orderCheckEntry &&
    samePrice(input.orderCheck.requestedEntry, orderCheckEntry) &&
    samePrice(input.orderCheck.stopLoss, input.slOn ? orderCheckStopLoss : null) &&
    samePrice(input.orderCheck.takeProfit, orderCheckTakeProfit) &&
    samePrice(input.orderCheck.limitPrice, normalizedLimitPrice),
  );
  const orderCheckTimeInForceMatches = (input.orderCheck?.timeInForce ?? 'gtc') === input.timeInForce;
  const takeProfitInputValid = !input.tpOn || input.takeProfit.trim() === '' || orderCheckTakeProfit !== null;
  const canCheckOrder = Boolean(
    allocationIssue === undefined &&
    input.stagedOnChart &&
    bridgeConnected &&
    input.symbol &&
    accountAvailable &&
    sizingAllowed &&
    orderVolumeValid &&
    orderCheckEntry &&
    limitPriceValid &&
    (!input.slOn || orderCheckStopLoss) &&
    previewReadyForCheck &&
    stopDistanceAllowed,
  );
  // Submit gate: connected bridge + accepted current OrderCheck (draftId) +
  // current risk preview + valid effective volume echoed by that OrderCheck +
  // non-empty entry/SL (TP only when non-empty) + account. The risk preview still
  // feeds the estimate display; volume coherence comes from the order_check_result
  // `volume` echo (verbatim per protocol) matching the field — in manual mode a
  // typed volume does not bump riskVersion, so matching draftVersions alone cannot
  // prove the accepted check covered the volume being submitted.
  // Freshness re-based on the OrderCheck result's own echo vs the ticket
  // fields (+ account/broker/orderKind/symbol/side identity): the preview chain
  // is required only when SL is on (it cannot exist with SL off). draftVersion
  // === riskVersion.current still fails after any pricing/size edit (the
  // preview effect bumps riskVersion) and the reset effect clears the check on
  // every payload dep incl. orderKind/limitPrice/timeInForce/unitsMode — the
  // "fresh accepted check" rule is not loosened.
  const canSubmitOrder = Boolean(
    allocationIssue === undefined &&
    input.stagedOnChart &&
    bridgeConnected &&
    input.marketOpen === true &&
    accountAvailable &&
    sizingAllowed &&
    acceptedCurrentCheck &&
    orderCheckAccountMatches &&
    orderCheckIdentityMatches &&
    orderVolumeValid &&
    orderCheckVolumeMatches &&
    orderCheckEntry &&
    (!input.slOn || orderCheckStopLoss) &&
    takeProfitInputValid &&
    orderCheckPricesMatch &&
    limitPriceValid &&
    orderCheckTimeInForceMatches &&
    stopDistanceAllowed &&
    (!previewRequired || previewCurrentForSubmit),
  );
  let ticketBlockedReason: string | undefined;
  if (!canSubmitOrder) {
    if (!bridgeConnected) {
      ticketBlockedReason = 'Bridge not connected.';
    } else if (!accountAvailable) {
      ticketBlockedReason = 'Account snapshot unavailable.';
    } else if (input.marketOpen !== true) {
      ticketBlockedReason =
        input.marketOpen === false
          ? 'Market is closed for this symbol — trading resumes when the session opens.'
          : 'Market session is unavailable — waiting for the bridge heartbeat.';
    } else if (!input.stagedOnChart) {
      ticketBlockedReason = 'Staged order was cleared from the chart — stage it again to send.';
    } else if (!orderVolumeValid) {
      ticketBlockedReason =
        effectiveVolume === '' ? 'Volume is required.' : (volumeIssue ?? 'Volume must be a positive decimal.');
    } else if (stopDistanceReason) {
      ticketBlockedReason = stopDistanceReason;
    } else if (allocationIssue) {
      ticketBlockedReason = allocationIssue;
    } else if (!sizingAllowed) {
      ticketBlockedReason = 'Money/% sizing needs a stop distance — enable Stop loss or switch to Units mode.';
    } else if (!limitPriceValid) {
      ticketBlockedReason = 'Stop limit requires limit price — enter the resting limit price on the ticket.';
    } else if (!acceptedCurrentCheck) {
      ticketBlockedReason = 'Run OrderCheck in MT5 — an accepted result for the current draft is required.';
    } else if (previewRequired && !previewCurrentForSubmit) {
      ticketBlockedReason = '';
    } else if (!orderCheckVolumeMatches) {
      ticketBlockedReason = 'Volume changed — run OrderCheck in MT5 again.';
    } else if (!orderCheckEntry || (input.slOn && !orderCheckStopLoss)) {
      ticketBlockedReason = 'Entry and stop loss must be valid prices.';
    } else if (!takeProfitInputValid) {
      ticketBlockedReason = 'Take profit must be a valid price or empty.';
    } else {
      ticketBlockedReason = 'Order panel is not ready.';
    }
  }
  return {
    orderCheckEntry,
    orderCheckStopLoss,
    orderCheckTakeProfit,
    normalizedLimitPrice,
    limitPriceValid,
    sizingAllowed,
    previewRequired,
    orderKindDisplay,
    effectiveVolume,
    volumeIssue,
    orderVolumeValid,
    stopGuard,
    canCheckOrder,
    canSubmitOrder,
    ticketBlockedReason,
  };
}
