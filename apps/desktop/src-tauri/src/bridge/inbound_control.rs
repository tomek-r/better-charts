//! Inbound connection-control messages, such as the terminal heartbeat.

use super::{now_ms, publish, send, Inbound, InboundOutcome, MarketSessionView};
use tokio::net::TcpStream;
use trading_core::protocol::{
    Envelope, ErrorCode, HeartbeatAckPayload, HeartbeatPayload, MessageType,
};

/// A valid heartbeat refreshes liveness before status publication and ACK
/// transmission, preserving the receive-time semantics of the connection loop.
pub(crate) async fn heartbeat(
    stream: &mut TcpStream,
    inbound: &Inbound<'_>,
    message: Envelope,
    last_heartbeat: &mut tokio::time::Instant,
) -> InboundOutcome {
    let heartbeat: HeartbeatPayload = match serde_json::from_value(message.payload) {
        Ok(v) => v,
        Err(_) => {
            return InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, "invalid heartbeat");
        }
    };
    // A present-but-malformed observation is rejected with the same error as a
    // malformed heartbeat: the app must never act on an unvalidated session.
    if let Some(session) = heartbeat.market_session.as_ref() {
        if session.validate().is_err() {
            return InboundOutcome::ErrorFrame(ErrorCode::InvalidMessage, "invalid heartbeat");
        }
    }
    {
        let _session_work = match inbound.state.session_work.lock() {
            Ok(guard) => guard,
            Err(_) => return InboundOutcome::Continue,
        };
        if inbound
            .state
            .current_session
            .lock()
            .expect("session mutex poisoned")
            .as_deref()
            != Some(inbound.session_id)
        {
            return InboundOutcome::Continue;
        }
        let active_server = inbound
            .state
            .status
            .lock()
            .expect("bridge status mutex poisoned")
            .server
            .clone();
        if active_server.as_deref() != Some(heartbeat.broker_server.as_str()) {
            return InboundOutcome::Teardown("broker server changed in session");
        }
        *last_heartbeat = tokio::time::Instant::now();
        publish(inbound.events, inbound.state, |status| {
            status.last_heartbeat = Some(now_ms());
            status.market_session = heartbeat.market_session.map(MarketSessionView::from);
        });
    }
    if send(
        stream,
        MessageType::HeartbeatAck,
        format!("ack-{}", heartbeat.sequence),
        Some(inbound.session_id.to_owned()),
        HeartbeatAckPayload {
            sequence: heartbeat.sequence,
        },
    )
    .await
    .is_err()
    {
        return InboundOutcome::Close;
    }
    InboundOutcome::HeartbeatAcked
}
