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
    | 'riskStopIntentRef'
    | 'riskPreview'
    | 'stagedDragging'
    | 'setStopLoss'
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
    | 'setDraftVersion'
    | 'setRiskPreview'
    | 'setRiskError'
    | 'setRiskLoading'
  >,
  { riskMode, effectiveRiskAmount }: { riskMode: 'usd' | 'equity'; effectiveRiskAmount: string },
): void {
  const {
    riskStopIntentRef,
    riskPreview,
    stagedDragging,
    setStopLoss,
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
      return;
    }
    const intent = riskStopIntentRef.current;
    if (intent && (intent.stopLoss !== stopLoss || intent.riskAmount !== riskAmount || unitsMode === 'units')) {
      riskStopIntentRef.current = undefined;
    }
    window.clearTimeout(pendingTimer.current);
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
      Number(effectiveRiskAmount) > 0 &&
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
      equityAllocationPercent,
      draftVersion: version,
    };
    if (unitsMode !== 'units' && !volumeManual && !riskStopIntentRef.current && riskPreviewDisplayRef.current) {
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
        .catch((error) => console.info('Local risk projection unavailable.', error));
    }
    pendingTimer.current = window.setTimeout(() => {
      void invoke('request_risk_preview', data).catch((error) => {
        if (version === riskVersionRef.current) {
          setRiskLoading(false);
          setRiskError('Risk preview is unavailable.');
        }
        console.info('Risk preview unavailable.', error);
      });
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
    riskStopIntentRef,
    setDraftVersion,
    setRiskPreview,
    setRiskError,
    setRiskLoading,
  ]);
  useEffect(() => {
    const intent = riskStopIntentRef.current;
    if (
      !intent ||
      !riskPreview ||
      stagedDragging ||
      ticketStage !== 'edit' ||
      riskPreview.draftVersion !== riskVersionRef.current ||
      intent.stopLoss !== stopLoss ||
      intent.riskAmount !== riskAmount ||
      unitsMode === 'units'
    ) {
      return;
    }
    if (intent.fitted) {
      riskStopIntentRef.current = undefined;
      return;
    }
    const version = riskPreview.draftVersion;
    // Obtain a broker quote first, then solve the inverse problem in Decimal.
    // Changing the stop triggers another quote; this result cannot satisfy send freshness.
    void invoke<RiskPreview | null>('project_risk_preview', {
      symbol: riskPreview.symbol,
      side: riskPreview.side,
      entry: riskPreview.entry,
      stopLoss: intent.seedStopLoss,
      takeProfit: riskPreview.takeProfit,
      riskAmount: effectiveRiskAmount,
      equityAllocationPercent,
      draftVersion: version,
      targetVolume: intent.volume,
    })
      .then((fitted) => {
        if (
          riskStopIntentRef.current !== intent ||
          riskVersionRef.current !== version ||
          currentStage.current !== 'edit'
        ) {
          return;
        }
        riskStopIntentRef.current = fitted ? { ...intent, stopLoss: fitted.stopLoss, fitted: true } : undefined;
        if (fitted) {
          setOrderVolume(fitted.volume);
          setStopLoss(fitted.stopLoss);
        }
      })
      .catch(() => {
        if (riskStopIntentRef.current === intent && riskVersionRef.current === version) {
          riskStopIntentRef.current = undefined;
          setRiskError('Unable to fit stop loss to the risk budget.');
        }
      });
  }, [
    riskPreview,
    stagedDragging,
    ticketStage,
    riskVersionRef,
    riskStopIntentRef,
    stopLoss,
    riskAmount,
    unitsMode,
    effectiveRiskAmount,
    equityAllocationPercent,
    setOrderVolume,
    setStopLoss,
    setRiskError,
  ]);
}
