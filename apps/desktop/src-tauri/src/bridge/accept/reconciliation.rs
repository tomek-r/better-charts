use super::super::{
    BridgeState, ExpectedReconciliation, ReconciliationStateKind, ReconciliationStatus,
};
use trading_core::protocol::{ReconcileError, ReconcileRequest, ReconcileSnapshot};

pub(crate) fn reconciliation_request_status(request: &ReconcileRequest) -> ReconciliationStatus {
    ReconciliationStatus {
        state: ReconciliationStateKind::Pending,
        request_id: Some(request.request_id.clone()),
        snapshot_id: None,
        account_login: Some(request.account_login.clone()),
        broker_server: Some(request.broker_server.clone()),
        captured_at_ms: None,
        history_from_ms: Some(request.history_from_ms),
        history_to_ms: None,
        sequence_before: None,
        sequence_after: None,
        position_count: 0,
        active_order_count: 0,
        history_order_count: 0,
        history_deal_count: 0,
        message: Some("waiting for terminal reconciliation snapshot".into()),
    }
}

pub(crate) fn reconciliation_snapshot_status(snapshot: &ReconcileSnapshot) -> ReconciliationStatus {
    let consistent = snapshot.complete && snapshot.sequence_before == snapshot.sequence_after;
    ReconciliationStatus {
        state: if consistent {
            ReconciliationStateKind::Complete
        } else {
            ReconciliationStateKind::Incomplete
        },
        request_id: Some(snapshot.request_id.clone()),
        snapshot_id: Some(snapshot.snapshot_id.clone()),
        account_login: Some(snapshot.account_login.clone()),
        broker_server: Some(snapshot.broker_server.clone()),
        captured_at_ms: Some(snapshot.captured_at_ms),
        history_from_ms: Some(snapshot.history_from_ms),
        history_to_ms: Some(snapshot.history_to_ms),
        sequence_before: Some(snapshot.sequence_before),
        sequence_after: Some(snapshot.sequence_after),
        position_count: snapshot.positions.len(),
        active_order_count: snapshot.active_orders.len(),
        history_order_count: snapshot.history_orders.len(),
        history_deal_count: snapshot.history_deals.len(),
        message: if consistent {
            Some("read-only broker snapshot accepted".into())
        } else {
            Some("snapshot is incomplete or account state changed during capture".into())
        },
    }
}

pub(crate) fn reconciliation_error_status(
    request: &ReconcileRequest,
    error: &ReconcileError,
) -> ReconciliationStatus {
    ReconciliationStatus {
        state: ReconciliationStateKind::Error,
        request_id: Some(request.request_id.clone()),
        snapshot_id: None,
        account_login: Some(request.account_login.clone()),
        broker_server: Some(request.broker_server.clone()),
        captured_at_ms: None,
        history_from_ms: Some(request.history_from_ms),
        history_to_ms: None,
        sequence_before: None,
        sequence_after: None,
        position_count: 0,
        active_order_count: 0,
        history_order_count: 0,
        history_deal_count: 0,
        message: Some(format!("{}: {}", error.code, error.message)),
    }
}

pub(crate) fn accept_reconciliation_snapshot(
    expected: &mut Option<ExpectedReconciliation>,
    session_id: &str,
    _envelope_id: &str,
    snapshot: ReconcileSnapshot,
) -> Result<Option<ReconciliationStatus>, &'static str> {
    let Some(current) = expected.as_ref() else {
        return Ok(None);
    };
    if current.session_id != session_id || snapshot.request_id != current.request.request_id {
        return Ok(None);
    }
    snapshot.validate(&current.request)?;
    let status = reconciliation_snapshot_status(&snapshot);
    *expected = None;
    Ok(Some(status))
}

pub(crate) fn accept_reconciliation_error(
    expected: &mut Option<ExpectedReconciliation>,
    session_id: &str,
    _envelope_id: &str,
    error: ReconcileError,
) -> Result<Option<ReconciliationStatus>, &'static str> {
    let Some(current) = expected.as_ref() else {
        return Ok(None);
    };
    if current.session_id != session_id || error.request_id != current.request.request_id {
        return Ok(None);
    }
    error.validate(&current.request)?;
    let status = reconciliation_error_status(&current.request, &error);
    *expected = None;
    Ok(Some(status))
}

pub(crate) fn accept_and_store_reconciliation_snapshot(
    state: &BridgeState,
    session_id: &str,
    envelope_id: &str,
    snapshot: ReconcileSnapshot,
) -> Result<Option<ReconciliationStatus>, &'static str> {
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .as_deref()
        != Some(session_id)
    {
        return Ok(None);
    }
    let mut expected = state
        .expected_reconciliation
        .lock()
        .expect("expected reconciliation mutex poisoned");
    accept_reconciliation_snapshot(&mut expected, session_id, envelope_id, snapshot)
}

pub(crate) fn accept_and_store_reconciliation_error(
    state: &BridgeState,
    session_id: &str,
    envelope_id: &str,
    error: ReconcileError,
) -> Result<Option<ReconciliationStatus>, &'static str> {
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .as_deref()
        != Some(session_id)
    {
        return Ok(None);
    }
    let mut expected = state
        .expected_reconciliation
        .lock()
        .expect("expected reconciliation mutex poisoned");
    accept_reconciliation_error(&mut expected, session_id, envelope_id, error)
}
