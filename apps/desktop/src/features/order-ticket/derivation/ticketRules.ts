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
import { stopDistanceGuard, type StopDistanceGuard } from '../exits/stopDistance';
import { isLimitPriceValid } from '../pricing/orderEntryPrice';
import { equityAllocationIssue } from '../sizing/riskBasis';
import type { UnitsMode } from '../sizing/unitsMode';
import { orderVolumeIssue } from '../sizing/volumeRules';
import { ticketBlockedReason } from './ticketBlockedReason';

// Numeric echo comparison: the OrderCheck result must match the ticket fields
// regardless of decimal formatting; null must stay null.
const samePrice = (echo: string | null | undefined, field: string | null): boolean =>
  field === null
    ? echo === null || echo === undefined
    : echo !== null && echo !== undefined && Number(echo) === Number(field);

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
  unitsMode: UnitsMode;
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

/** Derives the ticket gates from App state; the blocked reason follows the ordered chain in `ticketBlockedReason`. */
export function deriveOrderTicket(input: TicketDerivationInput): TicketDerivation {
  const orderCheckEntry = normalizedPrice(input.entry);
  const orderCheckStopLoss = input.slOn ? normalizedPrice(input.stopLoss) : null;
  const orderCheckTakeProfit = input.tpOn && input.takeProfit.trim() !== '' ? normalizedPrice(input.takeProfit) : null;
  // stop_limit's resting price — REQUIRED iff kind = stop_limit (backend
  // rejects "stop_limit requires limit_price"); null otherwise (sent as null,
  // which deserializes to None).
  const normalizedLimitPrice = input.orderKind === 'stop_limit' ? normalizedPrice(input.limitPrice) : null;
  const limitPriceValid = isLimitPriceValid(input.orderKind, input.limitPrice);
  // SL-off is only allowed with manual units sizing — money/% sizing needs the
  // stop distance for its risk math. Choosing risk sizing leaves the SL toggle
  // under the user's control; the gate blocks review until a stop is enabled.
  const sizingAllowed = input.slOn || input.unitsMode === 'units';
  // The risk preview (which itself REQUIRES a risk budget) is needed only for
  // money/% auto-sizing with a stop distance. Manual units volume runs the
  // chain on the OrderCheck echo alone, so the risk budget is then optional
  // (estimates only): typing units must not require a risk budget.
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
  // Nothing is checkable until a staged order exists (Buy/Sell click
  // stages; (✕)/Esc/unstage clear the staged order again).
  const allocationIssue =
    input.unitsMode === 'units' ? undefined : equityAllocationIssue(input.equityAllocationPercent ?? '100');
  const bridgeConnected = input.bridgeState === 'connected';
  const accountAvailable = Boolean(input.account?.accountLogin && input.account.brokerServer);
  const stopDistanceAllowed = !stopGuard?.slTooClose && !stopGuard?.tpTooClose;
  const stopDistanceReason = stopGuard?.slTooClose ? '' : stopGuard?.reason;
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
    ticketBlockedReason: ticketBlockedReason({
      canSubmitOrder,
      bridgeConnected,
      accountAvailable,
      marketOpen: input.marketOpen,
      stagedOnChart: input.stagedOnChart,
      orderVolumeValid,
      effectiveVolume,
      volumeIssue,
      stopDistanceReason,
      allocationIssue,
      sizingAllowed,
      limitPriceValid,
      acceptedCurrentCheck,
      previewRequired,
      previewCurrentForSubmit,
      orderCheckVolumeMatches,
      orderCheckEntry,
      slOn: input.slOn,
      orderCheckStopLoss,
      takeProfitInputValid,
    }),
  };
}
