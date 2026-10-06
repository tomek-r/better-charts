//! One accepted bridge connection: handshake, the post-handshake frame loop
//! and the server task that accepts connections forever.
//!
//! The loop is deliberately small. Per-frame work lives in the
//! `inbound_market` / `inbound_execution` handlers, which report back an
//! [`InboundOutcome`] so the loop — and only the loop — owns the two
//! teardown-adjacent side effects: answering a protocol violation with an
//! error frame and publishing the protocol-error status.

use super::{
    account_snapshot, bar_update, disconnect, flush_outbound, heartbeat, history_snapshot,
    order_check_error, order_check_result, order_command_error, order_command_update,
    portfolio_snapshot, protocol_error, protocol_error_session, publish, quote_update, read_one,
    reconcile_error, reconcile_snapshot, risk_quote_error, risk_quote_result, run_handshake,
    send_error, symbol_info, symbol_search, tick_history, tick_history_error, tick_price_history,
    BridgeConnectionState, BridgeEvents, BridgeState, ExecutionAdapterState, FrameSource,
    TauriBridgeEvents, DEFAULT_ADDR, HEARTBEAT_TIMEOUT,
};
use std::{env, net::SocketAddr, sync::Arc};
use tokio::net::{TcpListener, TcpStream};
use trading_core::protocol::{ErrorCode, MessageType, PROTOCOL_VERSION};

/// Shared context for one inbound frame, built after the version and
/// session checks. Holds only shared borrows so the loop keeps exclusive
/// access to the stream and can answer `ErrorFrame` outcomes.
pub(crate) struct Inbound<'a> {
    pub(crate) events: &'a Arc<dyn BridgeEvents>,
    pub(crate) state: &'a BridgeState,
    pub(crate) adapter: &'a ExecutionAdapterState,
    pub(crate) session_id: &'a str,
}

/// How the connection loop continues after one dispatched frame.
pub(crate) enum InboundOutcome {
    /// Frame handled; the loop continues with the next read.
    Continue,
    /// A healthy heartbeat was acknowledged after refreshing the liveness
    /// clock and publishing its status.
    HeartbeatAcked,
    /// The transport failed (an ack write could not complete); the loop
    /// disconnects without a protocol-error status.
    Close,
    /// Protocol violation; the loop publishes the error status and
    /// disconnects.
    Teardown(&'static str),
    /// Protocol violation; the loop answers with the error frame, publishes
    /// the error status and disconnects.
    ErrorFrame(ErrorCode, &'static str),
}

pub(crate) async fn handle_connection(
    mut stream: TcpStream,
    events: Arc<dyn BridgeEvents>,
    state: BridgeState,
    adapter: ExecutionAdapterState,
    expected_token: Arc<String>,
    session_number: u64,
) {
    // Small control frames should not wait behind Nagle coalescing. MQL5 does
    // not expose TCP_NODELAY, but enabling it on our endpoint removes the
    // avoidable half of that interaction.
    let _ = stream.set_nodelay(true);
    let mut source = FrameSource::new();
    let Some(session_id) = run_handshake(
        &mut stream,
        &mut source,
        &events,
        &state,
        &adapter,
        &expected_token,
        session_number,
    )
    .await
    else {
        return;
    };
    let mut outbound_rx = state.outbound_signal.subscribe();
    let mut last_heartbeat = tokio::time::Instant::now();
    loop {
        if state
            .current_session
            .lock()
            .expect("session mutex poisoned")
            .as_deref()
            != Some(session_id.as_str())
        {
            break;
        }
        if flush_outbound(&mut stream, &state, &adapter, &session_id)
            .await
            .is_err()
        {
            break;
        }
        let remaining = HEARTBEAT_TIMEOUT.saturating_sub(last_heartbeat.elapsed());
        let message = tokio::select! {
            // `read_one` may pop an already-decoded frame before returning
            // Ready. Prefer that branch when the outbound signal is also
            // ready so cancellation can never discard the popped frame.
            biased;
            result = read_one(&mut stream, &mut source, remaining) => {
                match result {
                    Ok(value) => value,
                    Err(_) => break,
                }
            }
            changed = outbound_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                // The loop head drains all last-wins pending slots and the
                // execution queue immediately.
                continue;
            }
        };
        if state
            .current_session
            .lock()
            .expect("session mutex poisoned")
            .as_deref()
            != Some(session_id.as_str())
        {
            break;
        }
        if message.v != PROTOCOL_VERSION {
            send_error(
                &mut stream,
                message.id,
                Some(session_id.clone()),
                ErrorCode::UnsupportedVersion,
                "unsupported protocol version",
            )
            .await;
            protocol_error_session(
                &events,
                &state,
                &adapter,
                &session_id,
                "unsupported protocol version",
            );
            break;
        }
        if message.session_id.as_deref() != Some(session_id.as_str()) {
            send_error(
                &mut stream,
                message.id,
                Some(session_id.clone()),
                ErrorCode::SessionMismatch,
                "session mismatch",
            )
            .await;
            protocol_error_session(&events, &state, &adapter, &session_id, "session mismatch");
            break;
        }
        let inbound = Inbound {
            events: &events,
            state: &state,
            adapter: &adapter,
            session_id: session_id.as_str(),
        };
        // Cloned before the dispatch consumes the envelope: the loop needs
        // the id to answer `ErrorFrame` outcomes.
        let message_id = message.id.clone();
        let outcome = match message.message_type {
            MessageType::HistorySnapshot => history_snapshot(&inbound, message).await,
            MessageType::BarUpdate => bar_update(&inbound, message).await,
            MessageType::PortfolioSnapshot => portfolio_snapshot(&inbound, message).await,
            MessageType::ReconcileSnapshot => reconcile_snapshot(&inbound, message).await,
            MessageType::ReconcileError => reconcile_error(&inbound, message).await,
            MessageType::OrderCheckError => order_check_error(&inbound, message).await,
            MessageType::OrderCheckResult => order_check_result(&inbound, message).await,
            MessageType::RiskQuoteError => risk_quote_error(&inbound, message).await,
            MessageType::RiskQuoteResult => risk_quote_result(&inbound, message).await,
            MessageType::AccountSnapshot => account_snapshot(&inbound, message).await,
            MessageType::QuoteUpdate => quote_update(&inbound, message).await,
            MessageType::SymbolInfoResult => symbol_info(&inbound, message).await,
            MessageType::SymbolSearchResult => symbol_search(&inbound, message).await,
            MessageType::TickHistorySnapshot => tick_history(&inbound, message).await,
            MessageType::TickPriceHistorySnapshot => tick_price_history(&inbound, message).await,
            MessageType::Error => tick_history_error(&inbound, message).await,
            // `heartbeat_ack` has no side effect beyond its parse, and the
            // original arm continued on both outcomes.
            MessageType::HeartbeatAck => InboundOutcome::Continue,
            MessageType::Heartbeat => {
                heartbeat(&mut stream, &inbound, message, &mut last_heartbeat).await
            }
            MessageType::OrderCommandUpdate => {
                order_command_update(&mut stream, &inbound, message).await
            }
            MessageType::OrderCommandError => {
                order_command_error(&mut stream, &inbound, message).await
            }
            // Handshake-only messages, request frames (the bridge is their
            // origin) and unknown variants are "unsupported control
            // message": error frame plus teardown, exactly like the final
            // guard of the original if-chain.
            _ => {
                InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, "unsupported control message")
            }
        };
        match outcome {
            InboundOutcome::Continue => continue,
            InboundOutcome::HeartbeatAcked => {}
            InboundOutcome::Close => break,
            InboundOutcome::Teardown(reason) => {
                protocol_error_session(&events, &state, &adapter, &session_id, reason);
                break;
            }
            InboundOutcome::ErrorFrame(code, reason) => {
                send_error(
                    &mut stream,
                    message_id,
                    Some(session_id.clone()),
                    code,
                    reason,
                )
                .await;
                protocol_error_session(&events, &state, &adapter, &session_id, reason);
                break;
            }
        }
        if last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
            break;
        }
    }
    disconnect(&events, &state, &adapter, &session_id);
}

/// A busy port must not permanently stop the bridge server. Retrying only
/// creates the listener; session establishment still requires a valid handshake.
pub(crate) async fn bind_listener(
    address: SocketAddr,
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
) -> TcpListener {
    let mut delay = std::time::Duration::from_secs(1);
    loop {
        match TcpListener::bind(address).await {
            Ok(listener) => {
                publish(events, state, |status| {
                    status.state = BridgeConnectionState::Connecting;
                    status.message = Some("Waiting for MT5 bridge to connect.".into());
                });
                return listener;
            }
            Err(error) => {
                publish(events, state, |status| {
                    status.state = BridgeConnectionState::ProtocolError;
                    status.message = Some(format!(
                        "bridge bind failed: {error}; retrying in {}s",
                        delay.as_secs()
                    ));
                });
                tokio::time::sleep(delay).await;
                delay = (delay * 2).min(std::time::Duration::from_secs(10));
            }
        }
    }
}

pub(crate) async fn run_server(
    app: tauri::AppHandle,
    state: BridgeState,
    adapter: ExecutionAdapterState,
) {
    let events: Arc<dyn BridgeEvents> = Arc::new(TauriBridgeEvents(app.clone()));
    let address = env::var("MT5_BRIDGE_ADDR").unwrap_or_else(|_| DEFAULT_ADDR.into());
    let address = match validate_bind_address(&address) {
        Ok(address) => address,
        Err(message) => {
            protocol_error(&events, &state, message);
            return;
        }
    };
    let listener = bind_listener(address, &events, &state).await;
    let token = Arc::new(env::var("MT5_BRIDGE_TOKEN").unwrap_or_default());
    let mut session_number = 0u64;
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(v) => v,
            Err(_) => continue,
        };
        session_number = session_number.wrapping_add(1);
        tauri::async_runtime::spawn(handle_connection(
            stream,
            Arc::clone(&events),
            state.clone(),
            adapter.clone(),
            token.clone(),
            session_number,
        ));
    }
}

pub(crate) fn validate_bind_address(value: &str) -> Result<SocketAddr, &'static str> {
    let address: SocketAddr = value.parse().map_err(|_| "invalid bridge address")?;
    if address.ip().is_loopback() {
        Ok(address)
    } else {
        Err("bridge address must use loopback")
    }
}
