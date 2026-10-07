//! Handlers for execution-domain frames of the post-handshake connection
//! loop: the reconciliation pair, the order-check and risk-preview pairs,
//! and the outbound command updates/errors the terminal applies.
//!
//! Reconciliation and order-check results drive the F-2 claim gate and the
//! validated-check slot through the shared `accept_and_store_*` helpers. The
//! two `order_command_*` frames are the only inbound traffic that mutates the
//! durable execution registry: a stale update is silently ignored, a
//! malformed payload earns an `INVALID_MESSAGE` frame, an account-binding
//! mismatch (F-5) earns `INVALID_MESSAGE` with no state change, and a failed
//! journal append (F-6) earns `INTERNAL_ERROR` "command journal unavailable"
//! on this connection only. Neither frame ever tears the session down.

use super::{
    accept_and_clear_order_check_error, accept_and_store_order_check_result,
    accept_and_store_reconciliation_error, accept_and_store_reconciliation_snapshot,
    adapter_error_frame, bridge_emit, calculate_risk_sizing, claim_for_session,
    publish_reconciliation_status, send_error, ExecutionCommandErrorView,
    ExecutionCommandUpdateView, Inbound, InboundOutcome, ReconciliationStateKind,
    RiskPreviewErrorView, RiskPreviewView,
};
use tokio::net::TcpStream;
use trading_core::protocol::{
    Envelope, ErrorCode, OrderCheckError, OrderCheckResult, OrderCommandError, OrderCommandUpdate,
    ReconcileError, ReconcileSnapshot, RiskQuoteError, RiskQuoteResult,
};

/// `reconcile_snapshot`: store the status and open/close the F-2 claim gate
/// with the `Complete` verdict.
pub(crate) async fn reconcile_snapshot(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let snapshot: ReconcileSnapshot = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid reconciliation snapshot"),
    };
    let accepted = match claim_for_session(inbound.state, inbound.session_id, || {
        let accepted = accept_and_store_reconciliation_snapshot(
            inbound.state,
            inbound.session_id,
            &message.id,
            snapshot,
        );
        if let Ok(Some(status)) = &accepted {
            publish_reconciliation_status(inbound.events, inbound.state, status.clone());
            inbound
                .adapter
                .set_reconciliation_complete(status.state == ReconciliationStateKind::Complete);
        }
        accepted
    }) {
        Ok(value) => value,
        Err(()) => return InboundOutcome::Continue,
    };
    match accepted {
        Ok(Some(_)) | Ok(None) => {}
        Err(_) => return InboundOutcome::Teardown("invalid reconciliation snapshot"),
    }
    InboundOutcome::Continue
}

/// `reconcile_error`: store the error status; it never satisfies the F-2
/// reconciliation gate.
pub(crate) async fn reconcile_error(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let error: ReconcileError = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid reconciliation error"),
    };
    let accepted = match claim_for_session(inbound.state, inbound.session_id, || {
        let accepted = accept_and_store_reconciliation_error(
            inbound.state,
            inbound.session_id,
            &message.id,
            error,
        );
        if let Ok(Some(status)) = &accepted {
            publish_reconciliation_status(inbound.events, inbound.state, status.clone());
            inbound.adapter.set_reconciliation_complete(false);
        }
        accepted
    }) {
        Ok(value) => value,
        Err(()) => return InboundOutcome::Continue,
    };
    match accepted {
        Ok(Some(_)) | Ok(None) => {}
        Err(_) => return InboundOutcome::Teardown("invalid reconciliation error"),
    }
    InboundOutcome::Continue
}

/// `order_check_error`: clear the validated-check slot when a pending
/// request answered with an error.
pub(crate) async fn order_check_error(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let error: OrderCheckError = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid order check error"),
    };
    let accepted = match claim_for_session(inbound.state, inbound.session_id, || {
        let has_pending_request = inbound
            .state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned")
            .is_some();
        let accepted =
            accept_and_clear_order_check_error(inbound.state, has_pending_request, error);
        if let Ok(Some(view)) = &accepted {
            bridge_emit(inbound.events, "order-check-error", view.clone());
        }
        accepted
    }) {
        Ok(value) => value,
        Err(()) => return InboundOutcome::Continue,
    };
    match accepted {
        Ok(Some(_)) | Ok(None) => {}
        Err(_) => return InboundOutcome::Teardown("invalid order check error"),
    }
    InboundOutcome::Continue
}

/// `order_check_result`: validate against the expected request and store the
/// validated result for the order-ticket preflight.
pub(crate) async fn order_check_result(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let result: OrderCheckResult = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid order check result"),
    };
    let accepted = match claim_for_session(inbound.state, inbound.session_id, || {
        let has_pending_request = inbound
            .state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned")
            .is_some();
        let accepted =
            accept_and_store_order_check_result(inbound.state, has_pending_request, result);
        if let Ok(Some(view)) = &accepted {
            bridge_emit(inbound.events, "order-check-result", view.clone());
        }
        accepted
    }) {
        Ok(value) => value,
        Err(()) => return InboundOutcome::Continue,
    };
    match accepted {
        Ok(Some(_)) | Ok(None) => {}
        Err(_) => return InboundOutcome::Teardown("invalid order check result"),
    }
    InboundOutcome::Continue
}

/// `risk_quote_error`: drop the expected risk request and surface the error
/// on the preview channel.
pub(crate) async fn risk_quote_error(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let error: RiskQuoteError = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid risk quote error"),
    };
    let active = claim_for_session(inbound.state, inbound.session_id, || {
        let expected = inbound
            .state
            .expected_risk
            .lock()
            .expect("risk mutex poisoned")
            .clone();
        let Some((expected_id, _, _, _, draft_version)) = expected else {
            return false;
        };
        if error.draft_id != expected_id {
            return false;
        }
        *inbound
            .state
            .expected_risk
            .lock()
            .expect("risk mutex poisoned") = None;
        bridge_emit(
            inbound.events,
            "risk-preview-error",
            RiskPreviewErrorView {
                draft_version,
                message: error.message,
            },
        );
        true
    });
    if active.is_err() {
        return InboundOutcome::Continue;
    }
    InboundOutcome::Continue
}

/// `risk_quote_result`: validate against the expected request, size the
/// position from the broker quote and publish the preview.
pub(crate) async fn risk_quote_result(inbound: &Inbound<'_>, message: Envelope) -> InboundOutcome {
    let result: RiskQuoteResult = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => return InboundOutcome::Teardown("invalid risk quote"),
    };
    let outcome = claim_for_session(inbound.state, inbound.session_id, || {
        let expected = inbound
            .state
            .expected_risk
            .lock()
            .expect("risk mutex poisoned")
            .clone();
        let Some((expected_id, request, risk, allocation, draft_version)) = expected else {
            return Ok(());
        };
        if result.draft_id != expected_id {
            return Ok(());
        }
        if result.validate(&request).is_err() {
            return Err("invalid risk quote");
        }
        let sizing = match size_risk_quote(inbound.state, risk, allocation, &result) {
            Ok(value) => value,
            Err(error) => {
                *inbound
                    .state
                    .expected_risk
                    .lock()
                    .expect("risk mutex poisoned") = None;
                bridge_emit(
                    inbound.events,
                    "risk-preview-error",
                    RiskPreviewErrorView {
                        draft_version,
                        message: error.to_string(),
                    },
                );
                return Ok(());
            }
        };
        *inbound
            .state
            .last_risk_quote
            .lock()
            .expect("risk quote mutex poisoned") =
            Some((inbound.session_id.to_owned(), result.clone()));
        let view = risk_preview_view(result, risk, sizing, draft_version);
        *inbound
            .state
            .expected_risk
            .lock()
            .expect("risk mutex poisoned") = None;
        bridge_emit(inbound.events, "risk-preview", view);
        Ok(())
    });
    match outcome {
        Err(()) | Ok(Ok(())) => {}
        Ok(Err(reason)) => return InboundOutcome::Teardown(reason),
    }
    InboundOutcome::Continue
}

pub(crate) fn risk_preview_view(
    result: RiskQuoteResult,
    risk: rust_decimal::Decimal,
    sizing: trading_core::position_sizing::RiskSizingResult,
    draft_version: u64,
) -> RiskPreviewView {
    RiskPreviewView {
        draft_version,
        symbol: result.symbol,
        side: result.side,
        currency: result.currency,
        entry: result.entry,
        stop_loss: result.stop_loss,
        take_profit: result.take_profit,
        risk_budget: risk.normalize().to_string(),
        volume: sizing.volume,
        estimated_risk: sizing.estimated_risk,
        estimated_margin: sizing.estimated_margin,
        estimated_reward: sizing.estimated_reward,
        rr: sizing.rr,
        quoted_at_ms: result.quoted_at_ms,
    }
}

/// Called inside the session claim: use the most recent bound account snapshot,
/// including updates received while the broker quote was in flight.
pub(super) fn size_risk_quote(
    state: &super::BridgeState,
    risk: rust_decimal::Decimal,
    allocation: rust_decimal::Decimal,
    quote: &RiskQuoteResult,
) -> Result<trading_core::position_sizing::RiskSizingResult, String> {
    let margin_budget = risk_margin_budget(state, allocation, quote)?;
    calculate_risk_sizing(risk, margin_budget, quote).map_err(|error| error.to_string())
}

pub(super) fn risk_margin_budget(
    state: &super::BridgeState,
    allocation: rust_decimal::Decimal,
    quote: &RiskQuoteResult,
) -> Result<rust_decimal::Decimal, String> {
    let account = state.account.lock().expect("account mutex poisoned");
    let account = account.as_ref().ok_or("account snapshot unavailable")?;
    if account.currency != quote.currency {
        return Err("risk quote currency does not match account".into());
    }
    let free_margin = account
        .free_margin
        .parse()
        .map_err(|_| "invalid account free margin")?;
    let equity = account
        .equity
        .parse()
        .map_err(|_| "invalid account equity")?;
    trading_core::position_sizing::equity_margin_budget(equity, free_margin, allocation)
        .map_err(|error| error.to_string())
}

/// `order_command_update`: validate the terminal's apply result and settle
/// the in-flight command in the durable registry.
pub(crate) async fn order_command_update(
    stream: &mut TcpStream,
    inbound: &Inbound<'_>,
    message: Envelope,
) -> InboundOutcome {
    let update: OrderCommandUpdate = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => {
            send_error(
                stream,
                message.id,
                Some(inbound.session_id.to_owned()),
                ErrorCode::InvalidMessage,
                "invalid order command update",
            )
            .await;
            return InboundOutcome::Continue;
        }
    };
    if update.validate().is_err() {
        send_error(
            stream,
            message.id,
            Some(inbound.session_id.to_owned()),
            ErrorCode::InvalidMessage,
            "invalid order command update",
        )
        .await;
        return InboundOutcome::Continue;
    }
    let view = ExecutionCommandUpdateView::from(&update);
    match inbound
        .adapter
        .apply_command_update_for_session(inbound.session_id, update)
    {
        Ok(Some(())) => {
            let _ = claim_for_session(inbound.state, inbound.session_id, || {
                bridge_emit(inbound.events, "execution-command-update", view);
            });
        }
        Ok(None) => {}
        Err(error) => {
            if matches!(
                error,
                crate::execution_adapter::ExecutionAdapterError::StaleSession
            ) {
                return InboundOutcome::Continue;
            }
            let (code, text) = adapter_error_frame(&error);
            send_error(
                stream,
                message.id,
                Some(inbound.session_id.to_owned()),
                code,
                text,
            )
            .await;
        }
    }
    InboundOutcome::Continue
}

/// `order_command_error`: validate the terminal's apply failure and settle
/// the in-flight command in the durable registry.
pub(crate) async fn order_command_error(
    stream: &mut TcpStream,
    inbound: &Inbound<'_>,
    message: Envelope,
) -> InboundOutcome {
    let error: OrderCommandError = match serde_json::from_value(message.payload) {
        Ok(value) => value,
        Err(_) => {
            send_error(
                stream,
                message.id,
                Some(inbound.session_id.to_owned()),
                ErrorCode::InvalidMessage,
                "invalid order command error",
            )
            .await;
            return InboundOutcome::Continue;
        }
    };
    if error.validate().is_err() {
        send_error(
            stream,
            message.id,
            Some(inbound.session_id.to_owned()),
            ErrorCode::InvalidMessage,
            "invalid order command error",
        )
        .await;
        return InboundOutcome::Continue;
    }
    let view = ExecutionCommandErrorView::from(&error);
    match inbound
        .adapter
        .apply_command_error_for_session(inbound.session_id, error)
    {
        Ok(()) => {
            let _ = claim_for_session(inbound.state, inbound.session_id, || {
                bridge_emit(inbound.events, "execution-command-error", view);
            });
        }
        Err(failure) => {
            if matches!(
                failure,
                crate::execution_adapter::ExecutionAdapterError::StaleSession
            ) {
                return InboundOutcome::Continue;
            }
            let (code, text) = adapter_error_frame(&failure);
            send_error(
                stream,
                message.id,
                Some(inbound.session_id.to_owned()),
                code,
                text,
            )
            .await;
        }
    }
    InboundOutcome::Continue
}
