use super::{mark_order_check_sent, BridgeState, ExpectedReconciliation};
use crate::execution_adapter::{ExecutionAdapterError, ExecutionAdapterState};
use std::{
    collections::VecDeque,
    sync::atomic::Ordering,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time,
};
use trading_core::protocol::{
    decode_json, encode_json, Envelope, ErrorCode, ErrorPayload, FrameDecoder, HistoryRequest,
    MessageType, MAX_FRAME_SIZE, PROTOCOL_VERSION,
};

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn envelope<T: serde::Serialize>(
    message_type: MessageType,
    id: String,
    session_id: Option<String>,
    payload: T,
) -> Envelope {
    Envelope {
        v: PROTOCOL_VERSION,
        message_type,
        id,
        session_id,
        sent_at_ms: now_ms(),
        payload: serde_json::to_value(payload).unwrap_or_else(|_| serde_json::json!({})),
    }
}

pub(crate) async fn send<T: serde::Serialize>(
    stream: &mut TcpStream,
    message_type: MessageType,
    id: String,
    session_id: Option<String>,
    payload: T,
) -> Result<(), ()> {
    let bytes = encode_json(&envelope(message_type, id, session_id, payload)).map_err(|_| ())?;
    stream.write_all(&bytes).await.map_err(|_| ())
}

pub(crate) async fn send_error(
    stream: &mut TcpStream,
    id: String,
    session_id: Option<String>,
    code: ErrorCode,
    message: &str,
) {
    let _ = send(
        stream,
        MessageType::Error,
        id,
        session_id,
        ErrorPayload {
            code,
            message: message.into(),
            retryable: false,
        },
    )
    .await;
}

/// Maps an inbound execution-apply failure to its frame-level answer: an F-5
/// account-binding mismatch becomes `INVALID_MESSAGE`, a failed journal
/// append (F-6, message "command journal unavailable") becomes
/// `INTERNAL_ERROR`. Callers answer with `send_error` only — never a session
/// teardown. This arm is reachable only inside `handle_connection`, which the
/// TCP-free unit tests cannot drive; the queue-release guarantee behind it is
/// covered by execution_adapter's
/// `journal_failure_releases_the_settled_slot_and_the_queue_keeps_moving`
/// test, and the frame mapping by this function's exhaustive match.
pub(crate) fn adapter_error_frame(error: &ExecutionAdapterError) -> (ErrorCode, &'static str) {
    match error {
        ExecutionAdapterError::AccountMismatch => (
            ErrorCode::InvalidMessage,
            "command account binding mismatch",
        ),
        _ => (ErrorCode::InternalError, "command journal unavailable"),
    }
}

/// Per-connection frame decoding state: the incremental [`FrameDecoder`] plus
/// fully decoded frames that were read from the socket but not yet
/// dispatched. It persists across `read_one` calls (handshake and loop), so
/// a frame decoded while filling the socket buffer is never lost.
pub(crate) struct FrameSource {
    decoder: FrameDecoder,
    pending: VecDeque<Vec<u8>>,
    max_frame_size: usize,
}

impl FrameSource {
    pub(crate) fn new() -> Self {
        Self {
            decoder: FrameDecoder::new(),
            pending: VecDeque::new(),
            max_frame_size: MAX_FRAME_SIZE,
        }
    }

    pub(crate) fn set_max_frame_size(&mut self, max_frame_size: usize) {
        self.decoder.set_max_frame_size(max_frame_size);
        self.max_frame_size = max_frame_size;
    }
}

pub(crate) async fn read_one(
    stream: &mut TcpStream,
    source: &mut FrameSource,
    timeout: Duration,
) -> Result<Envelope, ()> {
    let deadline = time::sleep(timeout);
    tokio::pin!(deadline);
    let mut buffer = [0u8; 8192];
    loop {
        if let Some(frame) = source.pending.pop_front() {
            // A frame decoded alongside hello still needs to satisfy the
            // negotiated limit when the handshake lowers the byte budget.
            if frame.len() > source.max_frame_size {
                return Err(());
            }
            return decode_json(&frame).map_err(|_| ());
        }
        let read = tokio::select! { result = stream.read(&mut buffer) => result.map_err(|_| ())?, _ = &mut deadline => return Err(()) };
        if read == 0 {
            return Err(());
        }
        let frames = source.decoder.push(&buffer[..read]).map_err(|_| ())?;
        source.pending.extend(frames);
    }
}

/// Drains every outbound slot without coupling application traffic to the
/// two-second health heartbeat. The caller runs this before each socket read
/// and is woken by `outbound_signal` when a Tauri command queues new work.
pub(crate) async fn flush_outbound(
    stream: &mut TcpStream,
    state: &BridgeState,
    adapter: &ExecutionAdapterState,
    session_id: &str,
) -> Result<(), ()> {
    {
        let _session_work = state.session_work.lock().map_err(|_| ())?;
        if state.current_session.lock().map_err(|_| ())?.as_deref() != Some(session_id) {
            return Ok(());
        }
    }
    let pending_request = claim_for_session(state, session_id, || {
        state
            .pending_history
            .lock()
            .expect("history mutex poisoned")
            .take()
    })?;
    if let Some(request) = pending_request {
        let request_id = format!(
            "rust-history-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        send(
            stream,
            MessageType::HistoryRequest,
            request_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        store_expected_history(state, session_id, request_id, request)?;
    }

    // Sent after the window on purpose: a window request clears the page slots,
    // so claiming it first means a page queued for the previous symbol or
    // timeframe is never written to the wire.
    let pending_page = claim_for_session(state, session_id, || {
        state
            .pending_history_page
            .lock()
            .expect("history page mutex poisoned")
            .take()
    })?;
    if let Some(request) = pending_page {
        let request_id = format!(
            "rust-history-page-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        send(
            stream,
            MessageType::HistoryRequest,
            request_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        claim_for_session(state, session_id, || {
            *state
                .expected_history_page
                .lock()
                .expect("history page mutex poisoned") = Some((request_id, request));
        })?;
    }

    let pending_symbol_info = claim_for_session(state, session_id, || {
        state
            .pending_symbol_info
            .lock()
            .expect("symbol info mutex poisoned")
            .take()
    })?;
    if let Some(request) = pending_symbol_info {
        let request_id = format!(
            "rust-symbol-info-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        send(
            stream,
            MessageType::SymbolInfoRequest,
            request_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        claim_for_session(state, session_id, || {
            *state
                .expected_symbol_info
                .lock()
                .expect("symbol info mutex poisoned") = Some((request_id, request));
        })?;
    }

    let pending_profile = claim_for_session(state, session_id, || {
        state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned")
            .take()
    })?;
    if pending_profile.is_some() {
        let (next_page, price_counts) = claim_for_session(state, session_id, || {
            let next_page = state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .next_page();
            let price_counts = *state
                .tick_price_counts
                .lock()
                .expect("tick capability mutex poisoned");
            (next_page, price_counts)
        })?;
        if let Some((generation, request)) = next_page {
            let request_id = format!(
                "rust-ticks-{}",
                state.next_request_id.fetch_add(1, Ordering::Relaxed)
            );
            send(
                stream,
                MessageType::TickHistoryRequest,
                request_id.clone(),
                Some(session_id.to_owned()),
                trading_core::protocol::TickPriceHistoryRequest {
                    history: request.wire.clone(),
                    price_counts,
                },
            )
            .await?;
            claim_for_session(state, session_id, || {
                *state
                    .expected_tick_profile
                    .lock()
                    .expect("tick profile mutex poisoned") =
                    Some((generation, request_id, request));
            })?;
        }
    }

    let pending_search = claim_for_session(state, session_id, || {
        state
            .pending_symbol_search
            .lock()
            .expect("symbol search mutex poisoned")
            .take()
    })?;
    if let Some(request) = pending_search {
        let request_id = format!(
            "rust-symbols-{}",
            state.next_request_id.fetch_add(1, Ordering::Relaxed)
        );
        send(
            stream,
            MessageType::SymbolSearchRequest,
            request_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        claim_for_session(state, session_id, || {
            *state
                .expected_symbol_search
                .lock()
                .expect("symbol search mutex poisoned") = Some((request_id, request));
        })?;
    }

    let pending_risk = claim_for_session(state, session_id, || {
        state
            .pending_risk
            .lock()
            .expect("risk mutex poisoned")
            .take()
    })?;
    if let Some((request, risk, allocation, draft_version)) = pending_risk {
        let request_id = request.draft_id.clone();
        send(
            stream,
            MessageType::RiskQuoteRequest,
            request_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        claim_for_session(state, session_id, || {
            *state.expected_risk.lock().expect("risk mutex poisoned") =
                Some((request_id, request, risk, allocation, draft_version));
        })?;
    }

    let pending_order_check = claim_for_session(state, session_id, || {
        state
            .pending_order_check
            .lock()
            .expect("order check mutex poisoned")
            .take()
    })?;
    if let Some((request, draft_version)) = pending_order_check {
        send(
            stream,
            MessageType::OrderCheckRequest,
            request.draft_id.clone(),
            Some(session_id.to_owned()),
            request.clone(),
        )
        .await?;
        claim_for_session(state, session_id, || {
            mark_order_check_sent(state, request, draft_version);
        })?;
    }

    let pending_reconciliation = claim_for_session(state, session_id, || {
        state
            .pending_reconciliation
            .lock()
            .expect("pending reconciliation mutex poisoned")
            .take()
    })?;
    if let Some(pending) = pending_reconciliation {
        if pending.session_id == session_id {
            send(
                stream,
                MessageType::ReconcileRequest,
                pending.request.request_id.clone(),
                Some(session_id.to_owned()),
                pending.request.clone(),
            )
            .await?;
            claim_for_session(state, session_id, || {
                *state
                    .expected_reconciliation
                    .lock()
                    .expect("expected reconciliation mutex poisoned") =
                    Some(ExpectedReconciliation {
                        session_id: session_id.to_owned(),
                        request: pending.request,
                    });
            })?;
        }
    }

    // Exactly one execution command may be in flight. The session-scoped
    // claim also enforces the dispatch, handshake and reconciliation gates.
    let command = claim_for_session(state, session_id, || {
        adapter.next_wire_message_for_session(session_id)
    })?;
    if let Some(command) = command {
        send(
            stream,
            command.message_type,
            command.command_id.clone(),
            Some(session_id.to_owned()),
            command.payload,
        )
        .await?;
    }
    Ok(())
}

/// Executes a synchronous state claim only while `session_id` is active.
/// The gate is always released before the caller can await socket I/O.
pub(crate) fn claim_for_session<T>(
    state: &BridgeState,
    session_id: &str,
    claim: impl FnOnce() -> T,
) -> Result<T, ()> {
    let _session_work = state.session_work.lock().map_err(|_| ())?;
    if state.current_session.lock().map_err(|_| ())?.as_deref() != Some(session_id) {
        return Err(());
    }
    Ok(claim())
}

fn store_expected_history(
    state: &BridgeState,
    session_id: &str,
    request_id: String,
    request: HistoryRequest,
) -> Result<(), ()> {
    claim_for_session(state, session_id, || {
        *state
            .expected_history
            .lock()
            .expect("history mutex poisoned") = Some((request_id, request));
    })
}

#[cfg(test)]
mod frame_tests {
    use super::*;

    #[test]
    fn replacement_during_outbound_write_keeps_new_slots_and_expectation() {
        let state = BridgeState::default();
        *state.current_session.lock().unwrap() = Some("session-old".to_owned());
        let old_request = HistoryRequest {
            symbol: "EURUSD".to_owned(),
            timeframe: "M1".to_owned(),
            bars: 100,
            before_ms: None,
        };
        *state.pending_history.lock().unwrap() = Some(old_request.clone());
        let claimed = claim_for_session(&state, "session-old", || {
            state.pending_history.lock().unwrap().take()
        })
        .unwrap();
        assert_eq!(claimed, Some(old_request));

        // This is the interval while the old connection is suspended in its
        // socket write after claiming the request.
        {
            let _session_work = state.session_work.lock().unwrap();
            *state.current_session.lock().unwrap() = Some("session-new".to_owned());
            *state.pending_history.lock().unwrap() = Some(HistoryRequest {
                symbol: "USDJPY".to_owned(),
                timeframe: "M5".to_owned(),
                bars: 50,
                before_ms: None,
            });
        }
        let new_request = HistoryRequest {
            symbol: "GBPUSD".to_owned(),
            timeframe: "M5".to_owned(),
            bars: 50,
            before_ms: None,
        };
        *state.expected_history.lock().unwrap() =
            Some(("new-request".to_owned(), new_request.clone()));

        assert!(store_expected_history(
            &state,
            "session-old",
            "old-request".to_owned(),
            HistoryRequest {
                symbol: "EURUSD".to_owned(),
                timeframe: "M1".to_owned(),
                bars: 100,
                before_ms: None,
            },
        )
        .is_err());
        assert_eq!(
            state
                .pending_history
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .symbol,
            "USDJPY"
        );
        assert_eq!(
            state.expected_history.lock().unwrap().as_ref(),
            Some(&("new-request".to_owned(), new_request))
        );
    }

    #[tokio::test]
    async fn frames_queued_before_negotiation_respect_a_lower_byte_budget() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let _client = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (mut stream, _) = listener.accept().await.unwrap();
        let message = envelope(
            MessageType::Heartbeat,
            "synthetic-heartbeat".into(),
            Some("synthetic-session".into()),
            serde_json::json!({"padding": "x".repeat(2048)}),
        );
        let mut source = FrameSource::new();
        source
            .pending
            .push_back(serde_json::to_vec(&message).unwrap());
        source.set_max_frame_size(1024);
        assert!(read_one(&mut stream, &mut source, Duration::from_secs(1))
            .await
            .is_err());
    }
}
