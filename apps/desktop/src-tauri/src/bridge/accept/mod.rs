use super::{
    bridge_emit, clear_validated_order_check, invalidate_validated_order_check,
    BridgeConnectionState, BridgeEvents, BridgeState, BridgeStatus, BrokerSymbolView,
    ExecutionAdapterState, ExpectedOrderCheck, OrderCheckError, OrderCheckErrorView,
    OrderCheckResult, OrderCheckResultView, ReconciliationStatus, SymbolInfoResult,
    SymbolSearchOutcome, SymbolSearchResult, SymbolSearchResultView, ValidatedOrderCheck,
};
use std::sync::Arc;

mod market;
mod reconciliation;
pub(crate) use market::*;
pub(crate) use reconciliation::*;

/// Accepts only the current expected search result, mirrors its symbols into
/// the persistent local cache, and builds the `source: "live"` view.
pub(crate) fn accept_symbol_search_result(
    state: &BridgeState,
    result: SymbolSearchResult,
) -> SymbolSearchOutcome {
    if state
        .pending_symbol_search
        .lock()
        .expect("symbol search mutex poisoned")
        .is_some()
    {
        return SymbolSearchOutcome::Stale;
    }
    let expected = state
        .expected_symbol_search
        .lock()
        .expect("symbol search mutex poisoned")
        .clone();
    let Some((expected_id, request)) = expected else {
        return SymbolSearchOutcome::Stale;
    };
    if result.request_id != expected_id {
        return SymbolSearchOutcome::Stale;
    }
    if result.validate(&request).is_err() {
        return SymbolSearchOutcome::Invalid;
    }
    *state
        .expected_symbol_search
        .lock()
        .expect("symbol search mutex poisoned") = None;
    state.remember_symbols(result.symbols.iter().cloned());
    SymbolSearchOutcome::Accepted(SymbolSearchResultView {
        source: "live".into(),
        query: result.query,
        symbols: result.symbols.into_iter().map(Into::into).collect(),
    })
}

pub(crate) fn accept_symbol_info(
    state: &BridgeState,
    result: SymbolInfoResult,
) -> Result<Option<BrokerSymbolView>, &'static str> {
    if state
        .pending_symbol_info
        .lock()
        .expect("symbol info mutex poisoned")
        .is_some()
    {
        return Ok(None);
    }
    let expected = state
        .expected_symbol_info
        .lock()
        .expect("symbol info mutex poisoned")
        .clone();
    let Some((expected_id, request)) = expected else {
        return Ok(None);
    };
    if result.request_id != expected_id {
        return Ok(None);
    }
    result.validate(&expected_id, &request)?;
    *state
        .expected_symbol_info
        .lock()
        .expect("symbol info mutex poisoned") = None;
    state.remember_symbols([result.symbol_info.clone()]);
    Ok(Some(result.symbol_info.into()))
}

pub(crate) fn accept_order_check_result(
    expected: &mut Option<ExpectedOrderCheck>,
    has_pending_request: bool,
    result: OrderCheckResult,
) -> Result<Option<OrderCheckResultView>, &'static str> {
    if has_pending_request {
        return Ok(None);
    }
    let Some((expected_id, request, draft_version)) = expected.as_ref() else {
        return Ok(None);
    };
    if result.draft_id != *expected_id {
        return Ok(None);
    }
    result.validate(request)?;
    let view = OrderCheckResultView {
        draft_version: *draft_version,
        draft_id: result.draft_id,
        account_login: result.account_login,
        broker_server: result.broker_server,
        symbol: result.symbol,
        side: result.side,
        order_kind: result.order_kind,
        volume: result.volume,
        requested_entry: result.requested_entry,
        check_price: result.check_price,
        stop_loss: result.stop_loss,
        take_profit: result.take_profit,
        check_passed: result.check_passed,
        retcode: result.retcode,
        last_error: result.last_error,
        balance: result.balance,
        equity: result.equity,
        profit: result.profit,
        margin: result.margin,
        free_margin: result.free_margin,
        margin_level: result.margin_level,
        comment: result.comment,
        checked_at_ms: result.checked_at_ms,
        time_in_force: result.time_in_force,
        limit_price: result.limit_price,
    };
    *expected = None;
    Ok(Some(view))
}

pub(crate) fn accept_and_store_order_check_result(
    state: &BridgeState,
    has_pending_request: bool,
    result: OrderCheckResult,
) -> Result<Option<OrderCheckResultView>, &'static str> {
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    let stored_result = result.clone();
    let Some(view) = accept_order_check_result(&mut expected, has_pending_request, result)? else {
        return Ok(None);
    };
    *state
        .validated_order_check
        .lock()
        .expect("validated order check mutex poisoned") = Some(ValidatedOrderCheck {
        result: stored_result,
        draft_version: view.draft_version,
    });
    Ok(Some(view))
}

pub(crate) fn accept_and_clear_order_check_error(
    state: &BridgeState,
    has_pending_request: bool,
    error: OrderCheckError,
) -> Result<Option<OrderCheckErrorView>, &'static str> {
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    let view = accept_order_check_error(&mut expected, has_pending_request, error)?;
    if view.is_some() {
        clear_validated_order_check(state);
    }
    Ok(view)
}

pub(crate) fn accept_order_check_error(
    expected: &mut Option<ExpectedOrderCheck>,
    has_pending_request: bool,
    error: OrderCheckError,
) -> Result<Option<OrderCheckErrorView>, &'static str> {
    if has_pending_request {
        return Ok(None);
    }
    let Some((expected_id, request, draft_version)) = expected.as_ref() else {
        return Ok(None);
    };
    if error.draft_id != *expected_id {
        return Ok(None);
    }
    error.validate(request)?;
    let view = OrderCheckErrorView {
        draft_version: *draft_version,
        draft_id: error.draft_id,
        code: error.code,
        message: error.message,
    };
    *expected = None;
    Ok(Some(view))
}

pub(crate) fn publish(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    update: impl FnOnce(&mut BridgeStatus),
) {
    let snapshot = {
        let mut status = state.status.lock().expect("bridge status mutex poisoned");
        update(&mut status);
        status.clone()
    };
    bridge_emit(events, "bridge-status", snapshot);
}

pub(crate) fn publish_reconciliation_status(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    status: ReconciliationStatus,
) {
    let mut slot = state
        .reconciliation_status
        .lock()
        .expect("reconciliation status mutex poisoned");
    *slot = status.clone();
    drop(slot);
    bridge_emit(events, "reconciliation-status", status);
}

pub(crate) fn reset_reconciliation(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    status: ReconciliationStatus,
) {
    *state
        .pending_reconciliation
        .lock()
        .expect("pending reconciliation mutex poisoned") = None;
    *state
        .expected_reconciliation
        .lock()
        .expect("expected reconciliation mutex poisoned") = None;
    publish_reconciliation_status(events, state, status);
}

pub(crate) fn protocol_error(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    message: impl Into<String>,
) {
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_some()
    {
        return;
    }
    invalidate_validated_order_check(state);
    state
        .tick_controller
        .lock()
        .expect("tick controller mutex poisoned")
        .cancel();
    publish(events, state, |status| {
        status.state = BridgeConnectionState::ProtocolError;
        status.message = Some(message.into());
        status.market_session = None;
    });
    reset_reconciliation(
        events,
        state,
        ReconciliationStatus::unavailable("bridge protocol error"),
    );
}

pub(crate) fn disconnect(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    adapter: &ExecutionAdapterState,
    session_id: &str,
) {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    let current = state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .clone();
    if current.as_deref() == Some(session_id) {
        publish(events, state, |status| {
            status.state = BridgeConnectionState::Disconnected;
            status.message = None;
            status.market_session = None;
        });
        *state
            .current_session
            .lock()
            .expect("session mutex poisoned") = None;
        reset_reconciliation(
            events,
            state,
            ReconciliationStatus::unavailable("bridge disconnected"),
        );
        invalidate_validated_order_check(state);
        *state
            .pending_history
            .lock()
            .expect("history mutex poisoned") = None;
        *state
            .expected_history
            .lock()
            .expect("history mutex poisoned") = None;
        *state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = None;
        *state
            .expected_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = None;
        state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned")
            .cancel();
        *state
            .pending_symbol_search
            .lock()
            .expect("symbol search mutex poisoned") = None;
        *state
            .expected_symbol_search
            .lock()
            .expect("symbol search mutex poisoned") = None;
        *state
            .pending_symbol_info
            .lock()
            .expect("symbol info mutex poisoned") = None;
        *state
            .expected_symbol_info
            .lock()
            .expect("symbol info mutex poisoned") = None;
        *state.quote.lock().expect("quote mutex poisoned") = None;
        *state.account.lock().expect("account mutex poisoned") = None;
        *state.portfolio.lock().expect("portfolio mutex poisoned") = None;
        *state.pending_risk.lock().expect("risk mutex poisoned") = None;
        *state.expected_risk.lock().expect("risk mutex poisoned") = None;
        *state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
        *state
            .expected_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
        // Session close (F-1): the in-flight command is journaled `unknown`
        // (never retried automatically) and every queued command is dropped
        // with a `QueueDropped` journal event.
        adapter.session_closed();
    }
}

pub(crate) fn protocol_error_session(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    adapter: &ExecutionAdapterState,
    session_id: &str,
    message: &str,
) {
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .as_deref()
        == Some(session_id)
    {
        publish(events, state, |status| {
            status.state = BridgeConnectionState::ProtocolError;
            status.message = Some(message.to_string());
            status.market_session = None;
        });
        *state
            .current_session
            .lock()
            .expect("session mutex poisoned") = None;
        // A protocol error ends this session exactly like a disconnect (F-1):
        // in-flight goes `unknown` through the journaled update path and
        // queued commands are dropped with a `QueueDropped` event — never
        // replayed into a future session.
        adapter.session_closed();
        reset_reconciliation(
            events,
            state,
            ReconciliationStatus::unavailable("bridge protocol error"),
        );
        invalidate_validated_order_check(state);
        *state
            .pending_history
            .lock()
            .expect("history mutex poisoned") = None;
        *state
            .expected_history
            .lock()
            .expect("history mutex poisoned") = None;
        *state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = None;
        *state
            .expected_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = None;
        state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned")
            .cancel();
        *state
            .pending_symbol_search
            .lock()
            .expect("symbol search mutex poisoned") = None;
        *state
            .expected_symbol_search
            .lock()
            .expect("symbol search mutex poisoned") = None;
        *state
            .pending_symbol_info
            .lock()
            .expect("symbol info mutex poisoned") = None;
        *state
            .expected_symbol_info
            .lock()
            .expect("symbol info mutex poisoned") = None;
        *state.quote.lock().expect("quote mutex poisoned") = None;
        *state.account.lock().expect("account mutex poisoned") = None;
        *state.portfolio.lock().expect("portfolio mutex poisoned") = None;
        *state.pending_risk.lock().expect("risk mutex poisoned") = None;
        *state.expected_risk.lock().expect("risk mutex poisoned") = None;
        *state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
        *state
            .expected_order_check
            .lock()
            .expect("order check mutex poisoned") = None;
    }
}
