//! Integration tests for the bridge connection layer.
//!
//! `handle_connection` is exercised end to end over a real loopback TCP pair:
//! the test plays the EA side, the spawned task plays the Rust server side
//! (minus the Tauri app, replaced by `RecordingEvents`). This covers the
//! handshake, session bookkeeping, stale/invalid snapshot handling, the
//! reconciliation gate, the execution command flow and the outbound flush
//! order — areas that previously had zero test coverage.
use super::*;
use crate::bridge::connection::handle_connection;
use crate::execution_journal::JournalError;
use trading_core::execution::{
    ExecutionIntent, ExecutionOperation, OrderKind as ExecOrderKind, OrderSide as ExecOrderSide,
    PlaceOrder,
};
use trading_core::protocol::{OrderKind, OrderSide};

mod connection_errors_tests;
mod handshake_history_tests;
mod heartbeat_outbound_tests;
mod history_page_tests;
mod reconciliation_execution_tests;
mod transfer_profile_tests;

/// Records events the server would emit to the frontend.
struct RecordingEvents {
    emitted: Mutex<Vec<(String, serde_json::Value)>>,
}

impl RecordingEvents {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            emitted: Mutex::new(Vec::new()),
        })
    }

    fn events(&self) -> Vec<(String, serde_json::Value)> {
        self.emitted.lock().expect("events mutex poisoned").clone()
    }

    fn has_event(&self, name: &str) -> bool {
        self.events().iter().any(|(event, _)| event == name)
    }

    fn quote_count(&self, symbol: &str) -> usize {
        self.events()
            .iter()
            .filter(|(event, payload)| *event == "quote-update" && payload["symbol"] == symbol)
            .count()
    }
}

impl BridgeEvents for RecordingEvents {
    fn emit_value(&self, event: &str, payload: &serde_json::Value) {
        self.emitted
            .lock()
            .expect("events mutex poisoned")
            .push((event.to_owned(), payload.clone()));
    }
}

/// Minimal EA-side client over the framed protocol.
struct BridgeClient {
    stream: TcpStream,
    source: FrameSource,
}

impl BridgeClient {
    async fn connect(addr: SocketAddr) -> std::io::Result<Self> {
        let stream = TcpStream::connect(addr).await?;
        Ok(Self {
            stream,
            source: FrameSource::new(),
        })
    }

    async fn send(&mut self, envelope: Envelope) -> std::io::Result<()> {
        let frame =
            encode_json(&envelope).map_err(|error| std::io::Error::other(error.to_string()))?;
        self.stream.write_all(&frame).await.map(|_| ())
    }

    fn envelope(
        message_type: MessageType,
        id: &str,
        session: Option<&str>,
        payload: serde_json::Value,
    ) -> Envelope {
        Envelope {
            v: PROTOCOL_VERSION,
            message_type,
            id: id.to_owned(),
            session_id: session.map(ToString::to_string),
            sent_at_ms: 1,
            payload,
        }
    }

    /// Reads one envelope or `None` when the deadline passes / the socket
    /// closes. Reuses production `read_one` on purpose.
    async fn recv(&mut self, timeout: Duration) -> Option<Envelope> {
        read_one(&mut self.stream, &mut self.source, timeout)
            .await
            .ok()
    }
}

/// Token every valid handshake must present.
const TEST_TOKEN: &str = "test-token";

struct BridgeHarness {
    addr: SocketAddr,
    events: Arc<RecordingEvents>,
    state: BridgeState,
    adapter: ExecutionAdapterState,
}

/// Starts a bare bridge server on loopback with a fresh session.
async fn start_bridge(state: BridgeState, adapter: ExecutionAdapterState) -> BridgeHarness {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback listener");
    let addr = listener.local_addr().expect("listener address");
    let events = RecordingEvents::new();
    let token = Arc::new(TEST_TOKEN.to_owned());
    let events_dyn: Arc<dyn BridgeEvents> = events.clone();
    let harness = BridgeHarness {
        addr,
        events,
        state: state.clone(),
        adapter: adapter.clone(),
    };
    tokio::spawn(async move {
        let Ok((stream, _)) = listener.accept().await else {
            return;
        };
        handle_connection(stream, events_dyn, state, adapter, token, 1).await;
    });
    harness
}

/// A handshake that always succeeds: valid v1 Hello, correct token, trading
/// enabled, and a concrete market symbol so quote updates can be validated.
fn valid_hello(session: Option<&str>) -> Envelope {
    BridgeClient::envelope(
        MessageType::Hello,
        "client-hello",
        session,
        serde_json::json!({
            "token": TEST_TOKEN,
            "terminal_id": "terminal-1",
            "terminal_build": 20250101,
            "account_login": "001234",
            "broker_server": "Broker-Demo",
            "chart_symbol": "EURUSD",
            "expert_version": trading_core::protocol::expert_adviser_version(),
            "tick_reader_version": trading_core::protocol::tick_reader_version(),
            "supported_timeframes": ["M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30",
                "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"],
            "trading_enabled": true,
        }),
    )
}

/// Artifacts of a completed handshake: the negotiated session id plus the
/// payloads of the proactive requests the server sent. Returning them keeps
/// tests from racing the server for frames this helper already consumed.
struct Handshake {
    session: String,
    history: HistoryRequest,
    history_id: String,
    reconcile: ReconcileRequest,
    transfer_limits: trading_core::protocol::TransferLimits,
}

/// Drives the handshake to completion: a valid v1 Hello with the correct
/// token and a concrete chart symbol. Consumes the four frames the server
/// sends proactively (HelloAck, HistoryRequest, SymbolInfoRequest,
/// ReconcileRequest) and returns their payloads.
async fn complete_handshake(client: &mut BridgeClient, _harness: &BridgeHarness) -> Handshake {
    complete_handshake_with_hello(client, valid_hello(None)).await
}

async fn complete_handshake_with_hello(client: &mut BridgeClient, hello: Envelope) -> Handshake {
    client.send(hello).await.expect("send hello");
    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("hello ack");
    assert_eq!(ack.message_type, MessageType::HelloAck);
    let payload: HelloAckPayload = serde_json::from_value(ack.payload).expect("hello ack payload");
    assert!(payload.trading_enabled);
    assert!(payload.heartbeat_interval_ms > 0);
    // The server proactively asks for history (sent directly)... the request
    // id lives on the envelope, not in the payload.
    let history = client
        .recv(Duration::from_secs(2))
        .await
        .expect("history request");
    assert_eq!(history.message_type, MessageType::HistoryRequest);
    let history_id = history.id.clone();
    let history =
        serde_json::from_value::<HistoryRequest>(history.payload).expect("history payload");
    // Only the first view is needed at connect; older pages are fetched on demand.
    assert_eq!(history.bars, trading_core::protocol::initial_history_bars());
    // ...and, on the first outbound flush, for symbol info and reconciliation.
    let symbol_info = client
        .recv(Duration::from_secs(2))
        .await
        .expect("symbol info request");
    assert_eq!(symbol_info.message_type, MessageType::SymbolInfoRequest);
    let reconcile = client
        .recv(Duration::from_secs(2))
        .await
        .expect("reconcile request");
    assert_eq!(reconcile.message_type, MessageType::ReconcileRequest);
    let reconcile =
        serde_json::from_value::<ReconcileRequest>(reconcile.payload).expect("reconcile payload");
    // The session id is server-generated; the HelloAck envelope carries it.
    let session = ack
        .session_id
        .clone()
        .expect("handshake should establish a session");
    Handshake {
        session,
        history,
        history_id,
        reconcile,
        transfer_limits: payload.transfer_limits,
    }
}

/// The bridge server runs in a spawned task on the single-threaded test
/// runtime, so it only makes progress while the test awaits. Poll the
/// predicate while yielding until it holds or the deadline passes; this keeps
/// tests deterministic without sleeping a fixed amount.
async fn wait_until(timeout: Duration, mut predicate: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    while !predicate() {
        tokio::select! {
            _ = &mut deadline => return false,
            _ = tokio::task::yield_now() => {}
        }
    }
    true
}

/// Fresh default state + unavailable adapter. The dispatch gate stays closed,
/// which keeps tests that only exercise the data path free of journals.
async fn default_harness() -> BridgeHarness {
    start_bridge(
        BridgeState::default(),
        ExecutionAdapterState::new(ExecutionSafetyState::unavailable()),
    )
    .await
}

/// Fresh durable-journal file for tests that drive real execution paths.
fn test_journal_path() -> std::path::PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("mt5-bridge-test-{}-{}", std::process::id(), id));
    std::fs::create_dir_all(&dir).expect("create journal dir");
    dir.join("journal")
}

/// Removes the journal file and its private directory after a test.
fn cleanup_journal(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::remove_dir_all(parent);
    }
}

/// A command the client can dispatch once the reconciliation gate is open.
fn place_order_intent(id: &str) -> ExecutionIntent {
    ExecutionIntent::new(
        id.to_owned(),
        "001234".to_owned(),
        "Broker-Demo".to_owned(),
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "EURUSD".to_owned(),
            side: ExecOrderSide::Buy,
            kind: ExecOrderKind::Market,
            volume: "0.10".to_owned(),
            entry: "1.10000".to_owned(),
            stop_loss: None,
            take_profit: None,
            time_in_force: None,
            limit_price: None,
        }),
    )
    .expect("valid intent")
}

/// Builds a reconciliation snapshot that satisfies `ReconcileSnapshot::validate`
/// for the request the server sent, with `complete` set so the dispatch gate
/// opens.
fn complete_reconcile_snapshot(request: &ReconcileRequest) -> ReconcileSnapshot {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(1);
    ReconcileSnapshot {
        request_id: request.request_id.clone(),
        account_login: request.account_login.clone(),
        broker_server: request.broker_server.clone(),
        snapshot_id: "snap-1".to_owned(),
        history_from_ms: request.history_from_ms,
        history_to_ms: now,
        sequence_before: 0,
        sequence_after: 0,
        complete: true,
        captured_at_ms: now,
        positions: Vec::new(),
        active_orders: Vec::new(),
        history_orders: Vec::new(),
        history_deals: Vec::new(),
    }
}
