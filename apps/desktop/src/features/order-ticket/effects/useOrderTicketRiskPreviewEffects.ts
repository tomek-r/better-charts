import { invoke } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RiskPreview } from '../../../shared/bridge/types';
import type { OrderTicketState } from '../state/useOrderTicket';
import { equityAllocationIssue, orderEntryPrice } from '../domain/ticketRules';

const RISK_PREVIEW_DEBOUNCE_MS = 100;

// Effect slot (2): the debounced risk-preview request [layout] — registered at
// its former slot between the timeframe reset and the staged-widget mirror.
// `riskMode`/`effectiveRiskAmount` are App's §10 risk-basis derivations (they
// feed the display too), passed in as the effect's external inputs.
export function useOrderTicketRiskPreviewEffects(
  ticket: Pick<
    OrderTicketState,
    | 'snapshot'
    | 'status'
    | 'account'
    | 'riskSide'
    | 'entry'
    | 'orderKind'
    | 'limitPrice'
    | 'stopLoss'
    | 'takeProfit'
    | 'equityAllocationPercent'
    | 'riskAmount'
    | 'slOn'
    | 'tpOn'
    | 'stopGuard'
    | 'ticketStage'
    | 'unitsMode'
    | 'volumeManual'
    | 'riskBrokerVersion'
    | 'setRiskProjection'
    | 'riskPreviewDisplayRef'
    | 'setOrderVolume'
    | 'riskVersion'
    | 'pendingRiskRequestRef'
    | 'setDraftVersion'
    | 'setRiskPreview'
    | 'setRiskError'
    | 'setRiskLoading'
  >,
  { riskMode, effectiveRiskAmount }: { riskMode: 'money' | 'equity'; effectiveRiskAmount: string },
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
    equityAllocationPercent,
    riskAmount,
    slOn,
    tpOn,
    stopGuard,
    ticketStage,
    unitsMode,
    volumeManual,
    riskBrokerVersion,
    setRiskProjection,
    riskPreviewDisplayRef,
    setOrderVolume,
    riskVersion,
    pendingRiskRequestRef,
    setDraftVersion,
    setRiskPreview,
    setRiskError,
    setRiskLoading,
  } = ticket;
  const riskVersionRef = riskVersion;
  const sizingEntry = orderEntryPrice(orderKind, entry, limitPrice);
  const equity = account?.equity;
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pendingTimer.current), []);
  const currentStage = useRef(ticketStage);
  useLayoutEffect(() => {
    currentStage.current = ticketStage;
  }, [ticketStage]);
  useLayoutEffect(() => {
    // Review pins the explicit request's prices and volume. Floating equity
    // must not create another draft or cancel its outstanding sizing response.
    if (ticketStage === 'review') {
      // A queued sizing command clears the backend's pending OrderCheck.
      // The review action flushes sizing before queuing its check.
      window.clearTimeout(pendingTimer.current);
      return;
    }
    window.clearTimeout(pendingTimer.current);
    pendingRiskRequestRef.current = undefined;
    const version = ++riskVersionRef.current;
    // Update the rendered freshness gate before paint, including the no-SL path.
    setDraftVersion(version);
    const symbol = snapshot.symbol;
    setRiskPreview(undefined);
    setRiskProjection(undefined);
    setRiskError(undefined);
    setRiskLoading(false);
    // Sizing NEVER derives from an invalid stop distance (owner: "not less than
    // the minimum required SL") — with the stop too close/crossed the preview
    // math is garbage and must not touch the units ("why change units when it
    // is 1"). The guard mirrors the EA preflight (distance > max(stopsLevel ×
    // pointSize, 20 × tickSize), with the reference selected by order kind).
    const valid = Boolean(
      equityAllocationIssue(equityAllocationPercent) === undefined &&
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
      (riskMode === 'equity' ? Number(riskAmount) > 0 && Number(riskAmount) <= 100 : Number(effectiveRiskAmount) > 0) &&
      !stopGuard?.slTooClose &&
      !stopGuard?.tpTooClose,
    );
    if (!valid || !symbol || !account?.accountLogin || !account.currency) {
      return;
    }
    setRiskLoading(true);
    const data = {
      symbol,
      side: riskSide,
      entry: sizingEntry,
      stopLoss: slOn ? stopLoss : '',
      takeProfit: tpOn && takeProfit.trim() ? takeProfit.trim() : null,
      riskAmount: effectiveRiskAmount,
      riskPercent: riskMode === 'equity' ? riskAmount : null,
      equityAllocationPercent,
      draftVersion: version,
    };
    if (unitsMode !== 'units' && !volumeManual && riskPreviewDisplayRef.current) {
      // Native Decimal sizing projects the cached broker quote immediately.
      // Keep it separate from riskPreview: only MT5 can satisfy freshness.
      void invoke<RiskPreview | null>('project_risk_preview', data)
        .then((projected) => {
          if (
            projected &&
            version === riskVersionRef.current &&
            currentStage.current === 'edit' &&
            riskBrokerVersion.current !== version
          ) {
            setRiskProjection(projected);
            setOrderVolume(projected.volume);
          }
        })
        .catch(() => undefined);
    }
    const request = () => {
      window.clearTimeout(pendingTimer.current);
      pendingRiskRequestRef.current = undefined;
      return invoke('request_risk_preview', data).catch((error) => {
        if (version === riskVersionRef.current) {
          setRiskLoading(false);
          setRiskError('Risk preview is unavailable.');
        }
        throw error;
      });
    };
    pendingRiskRequestRef.current = request;
    pendingTimer.current = window.setTimeout(() => {
      if (currentStage.current !== 'edit' || version !== riskVersionRef.current) {
        return;
      }
      void request().catch(() => undefined);
    }, RISK_PREVIEW_DEBOUNCE_MS);
  }, [
    snapshot.symbol,
    snapshot.timeframe,
    status.state,
    ticketStage,
    unitsMode,
    volumeManual,
    riskPreviewDisplayRef,
    setOrderVolume,
    setRiskProjection,
    riskBrokerVersion,
    account?.accountLogin,
    account?.brokerServer,
    account?.currency,
    account?.currencyDigits,
    riskSide,
    entry,
    orderKind,
    limitPrice,
    sizingEntry,
    stopLoss,
    takeProfit,
    riskAmount,
    riskMode,
    equityAllocationPercent,
    account?.freeMargin,
    slOn,
    tpOn,
    effectiveRiskAmount,
    stopGuard?.slTooClose,
    stopGuard?.tpTooClose,
    equity,
    riskVersionRef,
    pendingRiskRequestRef,
    setDraftVersion,
    setRiskPreview,
    setRiskError,
    setRiskLoading,
  ]);
}
