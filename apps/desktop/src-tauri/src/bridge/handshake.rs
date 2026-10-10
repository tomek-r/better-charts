use super::{
    disconnect, invalidate_validated_order_check, now_ms, protocol_error, protocol_error_session,
    publish, publish_market, publish_reconciliation_status, read_one,
    reconciliation_request_status, reset_reconciliation, send, send_error, BridgeConnectionState,
    BridgeEvents, BridgeState, ExecutionAdapterState, FrameSource, MarketSnapshot,
    PendingReconciliation, ReconciliationStatus, HANDSHAKE_TIMEOUT,
};
use std::{sync::atomic::Ordering, sync::Arc};
use tokio::net::TcpStream;
use trading_core::protocol::{
    default_timeframe, initial_history_bars, ErrorCode, HelloAckPayload, HelloPayload,
    HistoryRequest, MessageType, ReconcileRequest, SymbolInfoRequest, TransferLimits,
    PROTOCOL_VERSION,
};

/// A component version string from `hello`, or `None` when absent, not a
/// string, or not `<digits>.<digits>[.<digits>]` within 32 bytes.
fn reported_component_version(value: Option<&serde_json::Value>) -> Option<&str> {
    value.and_then(|value| value.as_str()).filter(|value| {
        value.len() <= 32
            && matches!(value.split('.').count(), 2 | 3)
            && value
                .split('.')
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    })
}

pub(crate) fn configured_transfer_limits(
    frame_bytes: Option<&str>,
) -> Result<TransferLimits, &'static str> {
    let mut limits = TransferLimits::measured_default();
    if let Some(value) = frame_bytes {
        limits.max_frame_bytes = value
            .parse()
            .map_err(|_| "invalid frame size configuration")?;
    }
    limits.validate()?;
    Ok(limits)
}

/// Post-accept protocol for one connection. On success returns the new
/// `session_id` with every post-handshake side effect already in place: the
/// slots are reset, the F-2/F-5 gates are armed, the bridge status and the
/// market snapshot are published, the `hello_ack` is sent, the 7-day
/// reconciliation request is queued, and the first 1000-bar history request
/// is in flight with its expected slot armed. Every failure path emits the
/// right status itself (or disconnects), so `None` means "return from the
/// connection task" and no further cleanup is needed.
pub(crate) async fn run_handshake(
    stream: &mut TcpStream,
    source: &mut FrameSource,
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    adapter: &ExecutionAdapterState,
    expected_token: &Arc<String>,
    session_number: u64,
) -> Option<String> {
    let hello = match read_one(stream, source, HANDSHAKE_TIMEOUT).await {
        Ok(v) => v,
        Err(_) => {
            protocol_error(events, state, "malformed handshake");
            return None;
        }
    };
    if hello.v != PROTOCOL_VERSION {
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::UnsupportedVersion,
            "unsupported protocol version",
        )
        .await;
        protocol_error(events, state, "unsupported protocol version");
        return None;
    }
    if hello.message_type != MessageType::Hello || hello.session_id.is_some() {
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::HandshakeRequired,
            "hello required",
        )
        .await;
        protocol_error(events, state, "hello required");
        return None;
    }
    let expected_version = trading_core::protocol::expert_adviser_version();
    let reported_version = reported_component_version(hello.payload.get("expert_version"));
    if reported_version != Some(expected_version) {
        let message = match reported_version {
            Some(version) => format!("App requires MT5 bridge version {expected_version}, but installed bridge version is {version}. Update and reattach BetterChartsBridge in MT5."),
            None => format!("App requires MT5 bridge version {expected_version}, but the bridge did not report a valid version. Update and reattach BetterChartsBridge in MT5."),
        };
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::UnsupportedVersion,
            &message,
        )
        .await;
        protocol_error(events, state, message);
        return None;
    }
    // Same reasoning as the EA check: validate before the schema parse, so an
    // outdated or missing reader gets a clear message. Invalid values are
    // never echoed back.
    let expected_reader = trading_core::protocol::tick_reader_version();
    let reported_reader = reported_component_version(hello.payload.get("tick_reader_version"));
    if reported_reader != Some(expected_reader) {
        let message = match reported_reader {
            Some(version) => format!("App requires MT5 tick reader version {expected_reader}, but installed tick reader version is {version}. Update BetterChartsTickHistoryReader in MQL5/Indicators, then reattach BetterChartsBridge in MT5."),
            None => format!("App requires MT5 tick reader version {expected_reader}, but the tick reader did not report a valid version. Install or update BetterChartsTickHistoryReader in MQL5/Indicators, then reattach BetterChartsBridge in MT5."),
        };
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::UnsupportedVersion,
            &message,
        )
        .await;
        protocol_error(events, state, message);
        return None;
    }
    let invalid_hello_message = "MT5 bridge sent an invalid connection handshake. Recompile and reattach BetterChartsBridge in MT5.";
    let hello_payload: HelloPayload = match serde_json::from_value(hello.payload) {
        Ok(v) => v,
        Err(_) => {
            send_error(
                stream,
                "rust-error".into(),
                None,
                ErrorCode::InvalidMessage,
                invalid_hello_message,
            )
            .await;
            protocol_error(events, state, invalid_hello_message);
            return None;
        }
    };
    if (expected_token.is_empty() && !cfg!(debug_assertions))
        || hello_payload.token != expected_token.as_str()
    {
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::AuthFailed,
            "authentication failed",
        )
        .await;
        protocol_error(events, state, "authentication failed");
        return None;
    }
    let supported_timeframes =
        match trading_core::protocol::supported_timeframes(&hello_payload.supported_timeframes) {
            Ok(codes) => codes,
            Err(message) => {
                send_error(
                    stream,
                    "rust-error".into(),
                    None,
                    ErrorCode::InvalidMessage,
                    message,
                )
                .await;
                protocol_error(events, state, message);
                return None;
            }
        };
    let configured_frame = std::env::var("MT5_BRIDGE_MAX_FRAME_BYTES").ok();
    let transfer_limits = match configured_transfer_limits(configured_frame.as_deref())
        .and_then(|limits| limits.negotiate(hello_payload.transfer_limits))
    {
        Ok(limits) => limits,
        Err(message) => {
            send_error(
                stream,
                "rust-error".into(),
                None,
                ErrorCode::InvalidMessage,
                message,
            )
            .await;
            protocol_error(events, state, message);
            return None;
        }
    };
    source.set_max_frame_size(transfer_limits.max_frame_bytes as usize);
    let requested_history = HistoryRequest {
        symbol: hello_payload.chart_symbol.clone(),
        timeframe: default_timeframe().into(),
        bars: initial_history_bars(),
        before_ms: None,
    };
    if requested_history.validate().is_err() {
        send_error(
            stream,
            "rust-error".into(),
            None,
            ErrorCode::InvalidMessage,
            "invalid chart symbol",
        )
        .await;
        protocol_error(events, state, "invalid chart symbol");
        return None;
    }
    let session_id = format!("session-{}-{}", now_ms(), session_number);
    let session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    *state
        .tick_price_counts
        .lock()
        .expect("tick capability mutex poisoned") = hello_payload.tick_price_counts;
    *state
        .transfer_limits
        .lock()
        .expect("transfer limits mutex poisoned") = transfer_limits;
    *state
        .current_session
        .lock()
        .expect("session mutex poisoned") = Some(session_id.clone());
    reset_reconciliation(
        events,
        state,
        ReconciliationStatus::unavailable("waiting for terminal reconciliation request"),
    );
    invalidate_validated_order_check(state);
    // A new session inherits nothing (F-1): the previous in-flight command
    // goes `unknown`, queued commands are dropped (`QueueDropped`); the
    // handshake arms the F-2 gates and the F-5 session account binding.
    adapter.session_started_for_session(
        &session_id,
        hello_payload.trading_enabled,
        &hello_payload.account_login,
        &hello_payload.broker_server,
    );
    *state
        .pending_history
        .lock()
        .expect("history mutex poisoned") = None;
    *state
        .expected_history
        .lock()
        .expect("history mutex poisoned") = None;
    // Pages belong to the session that asked for them.
    *state
        .pending_history_page
        .lock()
        .expect("history page mutex poisoned") = None;
    *state
        .expected_history_page
        .lock()
        .expect("history page mutex poisoned") = None;
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
        .clear();
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
        .expect("symbol info mutex poisoned") = Some(SymbolInfoRequest {
        symbol: requested_history.symbol.clone(),
    });
    *state
        .expected_symbol_info
        .lock()
        .expect("symbol info mutex poisoned") = None;
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
    publish(events, state, |status| {
        status.state = BridgeConnectionState::Connected;
        status.supported_timeframes = supported_timeframes;
        status.terminal = Some(hello_payload.terminal_id.clone());
        status.account = Some(hello_payload.account_login.clone());
        status.server = Some(hello_payload.broker_server.clone());
        status.message = None;
        status.market_session = None;
    });
    drop(session_work);
    publish_market(events, state, &session_id, MarketSnapshot::default());
    if send(
        stream,
        MessageType::HelloAck,
        "rust-hello-ack".into(),
        Some(session_id.clone()),
        HelloAckPayload {
            heartbeat_interval_ms: 2000,
            heartbeat_timeout_ms: 6000,
            trading_enabled: true,
            transfer_limits,
            tick_price_counts: hello_payload.tick_price_counts,
        },
    )
    .await
    .is_err()
    {
        disconnect(events, state, adapter, &session_id);
        return None;
    }
    let session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .as_deref()
        != Some(session_id.as_str())
    {
        return None;
    }
    let reconcile_request = ReconcileRequest {
        request_id: format!(
            "rust-reconcile-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        ),
        account_login: hello_payload.account_login.clone(),
        broker_server: hello_payload.broker_server.clone(),
        history_from_ms: now_ms().saturating_sub(7 * 24 * 60 * 60 * 1000).max(0),
        max_history_orders: 500,
        max_history_deals: 500,
    };
    if reconcile_request.validate().is_err() {
        drop(session_work);
        protocol_error_session(
            events,
            state,
            adapter,
            &session_id,
            "invalid reconciliation request",
        );
        return None;
    }
    *state
        .pending_reconciliation
        .lock()
        .expect("pending reconciliation mutex poisoned") = Some(PendingReconciliation {
        session_id: session_id.clone(),
        request: reconcile_request.clone(),
    });
    publish_reconciliation_status(
        events,
        state,
        reconciliation_request_status(&reconcile_request),
    );
    // A fresh request keeps the F-2 claim gate closed; it opens only when
    // the response below reaches `Complete`.
    adapter.set_reconciliation_complete(false);
    drop(session_work);
    let history_request_id = format!(
        "rust-history-{}",
        state.next_request_id.fetch_add(1, Ordering::Relaxed)
    );
    if send(
        stream,
        MessageType::HistoryRequest,
        history_request_id.clone(),
        Some(session_id.clone()),
        requested_history.clone(),
    )
    .await
    .is_err()
    {
        disconnect(events, state, adapter, &session_id);
        return None;
    }
    let _session_work = state
        .session_work
        .lock()
        .expect("session work mutex poisoned");
    if state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .as_deref()
        == Some(session_id.as_str())
    {
        *state
            .expected_history
            .lock()
            .expect("history mutex poisoned") =
            Some((history_request_id.clone(), requested_history.clone()));
    }
    Some(session_id)
}
