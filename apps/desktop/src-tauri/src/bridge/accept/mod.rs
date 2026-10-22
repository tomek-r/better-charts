use super::{
    bridge_emit, clear_profile_bar_slots, clear_validated_order_check,
    invalidate_validated_order_check, AccountView, BridgeConnectionState, BridgeEvents,
    BridgeState, BridgeStatus, BrokerSymbolView, ExecutionAdapterState, ExpectedOrderCheck,
    MarginRiskView, OrderCheckError, OrderCheckErrorView, OrderCheckResult, OrderCheckResultView,
    ReconciliationStatus, SymbolInfoResult, SymbolSearchOutcome, SymbolSearchResult,
    SymbolSearchResultView, ValidatedOrderCheck,
};
use rust_decimal::{Decimal, RoundingStrategy};
use std::sync::Arc;
use trading_core::margin_projection::{
    classify_margin_risk, project_margin_after_fill, MarginLevelsUnit,
};

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

struct MarginAfterFill {
    free_margin: Option<String>,
    margin_level: Option<String>,
    risk: MarginRiskView,
}

fn parse_decimal(value: &Option<String>) -> Option<Decimal> {
    value.as_deref()?.parse().ok()
}

/// Display-only projection of the account after the order fills. Funds come
/// from the account values sampled with the check itself (`account_*`, not the
/// `MqlTradeCheckResult` fields), so they are mutually consistent and valid
/// even when the check was not evaluated; broker thresholds come from the stored account snapshot, and
/// only when it belongs to the same login and server as the result. Nothing
/// here feeds a dispatch gate.
fn margin_after_fill(result: &OrderCheckResult, account: Option<&AccountView>) -> MarginAfterFill {
    // Never `result.equity`: it is MT5's post-deal figure, zero when the check
    // was not evaluated (e.g. retcode 10027), which would read as a 0% level.
    let equity = parse_decimal(&result.account_equity);
    let projection = project_margin_after_fill(
        equity,
        parse_decimal(&result.account_margin_used),
        parse_decimal(&result.account_free_margin),
        parse_decimal(&result.margin_at_fill),
    );
    let account = account.filter(|account| {
        account.account_login == result.account_login
            && account.broker_server == result.broker_server
    });
    let mode = account.and_then(|account| match account.margin_levels_mode {
        Some(0) => Some(MarginLevelsUnit::Percent),
        Some(1) => Some(MarginLevelsUnit::Money),
        _ => None,
    });
    let risk = classify_margin_risk(
        mode,
        account.and_then(|account| parse_decimal(&account.margin_call_level)),
        account.and_then(|account| parse_decimal(&account.stop_out_level)),
        equity,
        projection.margin_level_after,
    );
    MarginAfterFill {
        free_margin: projection.free_margin_after.map(|value| value.to_string()),
        margin_level: projection.margin_level_after.map(|value| {
            value
                .round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
                .to_string()
        }),
        risk: risk.into(),
    }
}

pub(crate) fn accept_order_check_result(
    expected: &mut Option<ExpectedOrderCheck>,
    has_pending_request: bool,
    account: Option<&AccountView>,
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
    let after_fill = margin_after_fill(&result, account);
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
        margin_at_fill: result.margin_at_fill,
        free_margin_after_fill: after_fill.free_margin,
        margin_level_after_fill: after_fill.margin_level,
        margin_risk: after_fill.risk,
    };
    *expected = None;
    Ok(Some(view))
}

pub(crate) fn accept_and_store_order_check_result(
    state: &BridgeState,
    has_pending_request: bool,
    result: OrderCheckResult,
) -> Result<Option<OrderCheckResultView>, &'static str> {
    // Cloned before taking the expected-check lock so the two mutexes are
    // never held together.
    let account = state
        .account
        .lock()
        .expect("account mutex poisoned")
        .clone();
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    let stored_result = result.clone();
    let Some(view) =
        accept_order_check_result(&mut expected, has_pending_request, account.as_ref(), result)?
    else {
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

/// Why a protocol error was reported. `ComponentOutdated` is fixed by
/// reinstalling the bundled MT5 files, `TokenMismatch` by installing them
/// through the setup guide, so each sets its own flag the UI reads;
/// `Other` sets neither.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProtocolErrorCause {
    ComponentOutdated,
    TokenMismatch,
    Other,
}

/// Publishes the protocol-error status. The caller has already decided that no
/// session is live; the cause rides along as machine-readable flags so no UI
/// code has to read `message`.
fn report_protocol_error(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    message: impl Into<String>,
    cause: ProtocolErrorCause,
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
        .end_session();
    clear_profile_bar_slots(state);
    publish(events, state, |status| {
        status.state = BridgeConnectionState::ProtocolError;
        status.message = Some(message.into());
        status.component_outdated = cause == ProtocolErrorCause::ComponentOutdated;
        status.token_mismatch = cause == ProtocolErrorCause::TokenMismatch;
        status.market_session = None;
        status.broker_utc_offset_minutes = None;
        status.partial_close = false;
        status.trading_enabled = false;
    });
    reset_reconciliation(
        events,
        state,
        ReconciliationStatus::unavailable("bridge protocol error"),
    );
}

/// A rejection the bundled MT5 files fix: the installed EA or tick reader is
/// not the version this app requires. Marks the status so the UI can offer
/// reinstalling them; the message keeps the human-readable instructions.
pub(crate) fn protocol_error_component_outdated(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    message: impl Into<String>,
) {
    report_protocol_error(
        events,
        state,
        message,
        ProtocolErrorCause::ComponentOutdated,
    );
}

pub(crate) fn protocol_error_token_mismatch(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    message: impl Into<String>,
) {
    report_protocol_error(events, state, message, ProtocolErrorCause::TokenMismatch);
}

pub(crate) fn protocol_error(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    message: impl Into<String>,
) {
    report_protocol_error(events, state, message, ProtocolErrorCause::Other);
}

/// Message the status carries while a restart waits for the terminal it launched:
/// nothing is wrong yet, the freshly installed advisor still has to connect.
const RESTARTED_TERMINAL_WAITING: &str = "Waiting for the restarted MetaTrader 5 to connect.";

/// Reports that a restart closed the old terminal and launched the new one, so the
/// app waits for the restarted advisor instead of keeping a refusal it can no
/// longer explain.
///
/// The `tokenMismatch`/`componentOutdated` flags describe the terminal that
/// presented them; the restart's startup preset carries the current token and the
/// files it just installed, so a refusal left behind is stale and would send the
/// user back to an install that already succeeded. Only a refusal (protocol error)
/// or a disconnect is replaced: a `connected` session is left to [`disconnect`],
/// which publishes its own status when the restart drops it, and a refusal from the
/// new terminal is published normally.
pub(crate) fn expect_restarted_terminal(events: &Arc<dyn BridgeEvents>, state: &BridgeState) {
    let awaits_terminal = {
        let status = state.status.lock().expect("bridge status mutex poisoned");
        matches!(
            status.state,
            BridgeConnectionState::Disconnected | BridgeConnectionState::ProtocolError
        )
    };
    if !awaits_terminal {
        return;
    }
    publish(events, state, |status| {
        status.state = BridgeConnectionState::Connecting;
        status.message = Some(RESTARTED_TERMINAL_WAITING.to_owned());
        status.component_outdated = false;
        status.token_mismatch = false;
    });
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
            status.component_outdated = false;
            status.token_mismatch = false;
            status.market_session = None;
            status.broker_utc_offset_minutes = None;
            status.partial_close = false;
            status.trading_enabled = false;
        });
        *state
            .current_session
            .lock()
            .expect("session mutex poisoned") = None;
        state
            .chart_selection
            .lock()
            .expect("chart selection mutex poisoned")
            .session_ended(false);
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
            .end_session();
        clear_profile_bar_slots(state);
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
            // A session-level error is never a version mismatch: both are
            // checked before a session exists.
            status.component_outdated = false;
            status.token_mismatch = false;
            status.market_session = None;
            status.broker_utc_offset_minutes = None;
            status.partial_close = false;
            status.trading_enabled = false;
        });
        *state
            .current_session
            .lock()
            .expect("session mutex poisoned") = None;
        state
            .chart_selection
            .lock()
            .expect("chart selection mutex poisoned")
            .session_ended(true);
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
            .end_session();
        clear_profile_bar_slots(state);
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
