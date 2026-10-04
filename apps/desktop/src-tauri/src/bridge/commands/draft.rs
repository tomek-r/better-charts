//! Draft preflight surface: the risk preview and order-check requests
//! that validate an order draft against the active account before any
//! gated submission, plus the validated-check slot bookkeeping they
//! share with the bridge loop.

use super::super::{
    BridgeConnectionState, BridgeState, OrderCheckRequest, OrderKind, OrderSide, RiskQuoteRequest,
    TimeInForce,
};
use std::sync::atomic::Ordering;
use tauri::State;
use trading_core::protocol::{protective_price, validate_stop_distances};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn request_risk_preview(
    state: State<'_, BridgeState>,
    symbol: String,
    side: String,
    entry: String,
    stop_loss: String,
    take_profit: Option<String>,
    risk_amount: String,
    draft_version: u64,
) -> Result<(), String> {
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let side = match side.as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => return Err("invalid order side".into()),
    };
    let risk = risk_amount
        .parse::<rust_decimal::Decimal>()
        .map_err(|_| "invalid risk amount".to_string())?;
    if risk <= rust_decimal::Decimal::ZERO {
        return Err("risk amount must be non-negative".into());
    }
    invalidate_validated_order_check(&state);
    let request = RiskQuoteRequest {
        draft_id: format!(
            "draft-{draft_version}-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        symbol,
        side,
        entry,
        stop_loss,
        take_profit,
    };
    request.validate().map_err(str::to_owned)?;
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none()
    {
        return Err("bridge is not connected".into());
    }
    if state
        .market
        .lock()
        .expect("market mutex poisoned")
        .symbol
        .as_deref()
        != Some(request.symbol.as_str())
    {
        return Err("risk symbol does not match active chart".into());
    }
    if state
        .account
        .lock()
        .expect("account mutex poisoned")
        .is_none()
    {
        return Err("account snapshot is unavailable".into());
    }
    *state.pending_risk.lock().expect("risk mutex poisoned") = Some((request, risk, draft_version));
    *state.expected_risk.lock().expect("risk mutex poisoned") = None;
    state.wake_outbound();
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn request_order_check(
    state: State<'_, BridgeState>,
    account_login: String,
    broker_server: String,
    symbol: String,
    side: String,
    order_kind: String,
    volume: String,
    entry: String,
    stop_loss: Option<String>,
    take_profit: Option<String>,
    time_in_force: Option<String>,
    limit_price: Option<String>,
    draft_version: u64,
) -> Result<(), String> {
    let _session_work = state
        .session_work
        .lock()
        .map_err(|_| "bridge session unavailable".to_string())?;
    let side = match side.as_str() {
        "buy" => OrderSide::Buy,
        "sell" => OrderSide::Sell,
        _ => return Err("invalid order side".into()),
    };
    let order_kind = match order_kind.as_str() {
        "market" => OrderKind::Market,
        "limit" => OrderKind::Limit,
        "stop" => OrderKind::Stop,
        "stop_limit" => OrderKind::StopLimit,
        _ => return Err("invalid order kind".into()),
    };
    let time_in_force = parse_time_in_force(time_in_force)?;
    let status = state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .clone();
    let session = state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .clone();
    if status.state != BridgeConnectionState::Connected || session.is_none() {
        return Err("bridge is not connected".into());
    }
    let account = state
        .account
        .lock()
        .expect("account mutex poisoned")
        .clone()
        .ok_or_else(|| "account snapshot is unavailable".to_string())?;
    if status.account.as_deref() != Some(account.account_login.as_str())
        || status.server.as_deref() != Some(account.broker_server.as_str())
    {
        return Err("account snapshot does not match connected account".into());
    }
    if account_login != account.account_login || broker_server != account.broker_server {
        return Err("requested account does not match account snapshot".into());
    }
    if state
        .market
        .lock()
        .expect("market mutex poisoned")
        .symbol
        .as_deref()
        != Some(symbol.as_str())
    {
        return Err("order check symbol does not match active chart".into());
    }
    let request = OrderCheckRequest {
        draft_id: format!(
            "draft-{draft_version}-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        account_login: account.account_login,
        broker_server: account.broker_server,
        symbol,
        side,
        order_kind,
        volume,
        entry,
        stop_loss,
        take_profit,
        time_in_force,
        limit_price,
    };
    request.validate().map_err(str::to_owned)?;
    // Reject stops inside the local margin BEFORE the MT5 roundtrip, with the
    // same wording the EA preflight would journal.
    preflight_stop_distance(&state, &request)?;
    queue_order_check(&state, request, draft_version);
    state.wake_outbound();
    Ok(())
}

/// Parses the optional `time_in_force` argument of the order commands. The
/// wire/Tauri spelling is snake_case; `None` (absent) means `gtc`, the
/// pre-extension default, so today's callers keep byte-identical payloads.
pub(crate) fn parse_time_in_force(value: Option<String>) -> Result<Option<TimeInForce>, String> {
    match value.as_deref() {
        None => Ok(None),
        Some("gtc") => Ok(Some(TimeInForce::Gtc)),
        Some("day") => Ok(Some(TimeInForce::Day)),
        Some("ioc") => Ok(Some(TimeInForce::Ioc)),
        Some("fok") => Ok(Some(TimeInForce::Fok)),
        Some(_) => Err("time_in_force must be gtc, day, ioc, or fok".into()),
    }
}

/// Preflight mirror of the EA's stop-distance rule: a SL/TP closer than
/// `max(stops_level*point, 20*tick)` from market quote sides or the pending
/// opening price (resting limit for StopLimit) is rejected
/// locally with the shared `stop_loss too close: …` reason. Defers to the EA
/// preflight when symbol metadata or a quote for this symbol is unavailable —
/// nothing is blocked just because the cache is cold.
pub(crate) fn preflight_stop_distance(
    state: &BridgeState,
    request: &OrderCheckRequest,
) -> Result<(), String> {
    let metadata = state
        .symbol_cache
        .lock()
        .expect("symbol cache mutex poisoned")
        .cache
        .get(&request.symbol)
        .cloned();
    let quote = state.quote.lock().expect("quote mutex poisoned").clone();
    let (Some(metadata), Some(quote)) = (metadata, quote) else {
        return Ok(());
    };
    if quote.symbol != request.symbol {
        return Ok(());
    }
    let Ok(point_size) = metadata.point_size.parse::<rust_decimal::Decimal>() else {
        return Ok(());
    };
    let Ok(tick_size) = metadata.tick_size.parse::<rust_decimal::Decimal>() else {
        return Ok(());
    };
    let Ok(bid) = quote.bid.parse::<rust_decimal::Decimal>() else {
        return Ok(());
    };
    let Ok(ask) = quote.ask.parse::<rust_decimal::Decimal>() else {
        return Ok(());
    };
    // Absent SL = no SL level to check (optional-stop-loss contract); a
    // present-but-unparseable value just defers to the EA preflight, the same
    // let-else shape as the other parsed levels.
    let stop_loss = match request.stop_loss.as_deref() {
        None => None,
        Some(value) => {
            let Ok(parsed) = value.parse::<rust_decimal::Decimal>() else {
                return Ok(());
            };
            Some(parsed)
        }
    };
    // `request.validate()` already proved the grammar; a value too large for
    // Decimal just widens the deferral to the EA preflight.
    let take_profit = request
        .take_profit
        .as_deref()
        .and_then(|value| value.parse::<rust_decimal::Decimal>().ok());
    let (bid, ask) = if request.order_kind == OrderKind::Market {
        (bid, ask)
    } else {
        let reference = protective_price(
            request.order_kind,
            &request.entry,
            request.limit_price.as_deref(),
        )
        .map_err(str::to_owned)?;
        let Ok(reference) = reference.parse::<rust_decimal::Decimal>() else {
            return Ok(());
        };
        (reference, reference)
    };
    validate_stop_distances(
        request.side,
        stop_loss.as_ref(),
        take_profit,
        metadata.stops_level,
        point_size,
        tick_size,
        bid,
        ask,
    )
}

pub(crate) fn queue_order_check(
    state: &BridgeState,
    request: OrderCheckRequest,
    draft_version: u64,
) {
    let mut pending = state
        .pending_order_check
        .lock()
        .expect("order check mutex poisoned");
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    clear_validated_order_check(state);
    *pending = Some((request, draft_version));
    *expected = None;
}

pub(crate) fn clear_validated_order_check(state: &BridgeState) {
    *state
        .validated_order_check
        .lock()
        .expect("validated order check mutex poisoned") = None;
}

pub(crate) fn invalidate_validated_order_check(state: &BridgeState) {
    let mut pending = state
        .pending_order_check
        .lock()
        .expect("order check mutex poisoned");
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    *pending = None;
    *expected = None;
    clear_validated_order_check(state);
}

pub(crate) fn mark_order_check_sent(
    state: &BridgeState,
    request: OrderCheckRequest,
    draft_version: u64,
) {
    let pending = state
        .pending_order_check
        .lock()
        .expect("order check mutex poisoned");
    let mut expected = state
        .expected_order_check
        .lock()
        .expect("order check mutex poisoned");
    if pending.is_none() {
        *expected = Some((request.draft_id.clone(), request, draft_version));
    }
}
