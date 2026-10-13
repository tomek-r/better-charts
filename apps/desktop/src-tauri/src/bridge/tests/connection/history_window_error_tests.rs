//! The EA answers a window history request it could not synchronize in time
//! with an `error` whose envelope id is the request id. That failure ends only
//! the request: the session, the reconciliation state and the dispatch gates
//! stay as they were, and no stale candles are shown.
use super::*;

const WAIT: Duration = Duration::from_secs(2);

struct WindowConnection {
    harness: BridgeHarness,
    client: BridgeClient,
    handshake: Handshake,
}

async fn window_connection() -> WindowConnection {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    WindowConnection {
        harness,
        client,
        handshake,
    }
}

impl WindowConnection {
    async fn send_internal_error(&mut self, id: &str, session: &str) {
        self.client
            .send(BridgeClient::envelope(
                MessageType::Error,
                id,
                Some(session),
                serde_json::json!({
                    "code": "INTERNAL_ERROR",
                    "message": "history synchronization timed out",
                    "retryable": false
                }),
            ))
            .await
            .unwrap();
    }

    /// An in-order heartbeat ack proves the server dispatched every earlier
    /// frame and the session is still open.
    async fn assert_session_alive(&mut self) {
        self.client
            .send(BridgeClient::envelope(
                MessageType::Heartbeat,
                "hb-window",
                Some(&self.handshake.session),
                serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
            ))
            .await
            .unwrap();
        let ack = self.client.recv(WAIT).await.expect("session still open");
        assert_eq!(ack.message_type, MessageType::HeartbeatAck);
        assert_eq!(
            self.harness
                .state
                .current_session
                .lock()
                .unwrap()
                .as_deref(),
            Some(self.handshake.session.as_str())
        );
    }

    fn window_is_expected(&self) -> bool {
        self.harness
            .state
            .expected_history
            .lock()
            .unwrap()
            .is_some()
    }

    fn reconciliation_is_pending(&self) -> bool {
        self.harness
            .state
            .pending_reconciliation
            .lock()
            .unwrap()
            .is_some()
    }
}

#[tokio::test]
async fn correlated_window_error_reports_history_unavailable_and_keeps_the_session() {
    let mut connection = window_connection().await;
    let reconciliation_was_pending = connection.reconciliation_is_pending();
    let id = connection.handshake.history_id.clone();
    let session = connection.handshake.session.clone();
    connection.send_internal_error(&id, &session).await;
    assert!(
        wait_until(WAIT, || connection
            .harness
            .events
            .has_event("history-unavailable"))
        .await,
        "the failed window must be reported"
    );
    let (_, payload) = connection
        .harness
        .events
        .events()
        .into_iter()
        .find(|(event, _)| event == "history-unavailable")
        .unwrap();
    assert_eq!(payload["symbol"], connection.handshake.history.symbol);
    assert_eq!(payload["timeframe"], connection.handshake.history.timeframe);
    assert!(!connection.window_is_expected());
    assert!(
        connection
            .harness
            .state
            .market
            .lock()
            .unwrap()
            .candles
            .is_empty(),
        "no candles are published for an unsynchronized series"
    );
    connection.assert_session_alive().await;
    // Reconciliation and the dispatch gates are not touched by a history failure.
    assert_eq!(
        connection.reconciliation_is_pending(),
        reconciliation_was_pending
    );
}

#[tokio::test]
async fn stale_window_error_is_ignored() {
    let mut connection = window_connection().await;
    let session = connection.handshake.session.clone();
    connection
        .send_internal_error("rust-history-0", &session)
        .await;
    connection.assert_session_alive().await;
    assert!(connection.window_is_expected(), "the awaited window stays");
    assert!(!connection.harness.events.has_event("history-unavailable"));
}

#[tokio::test]
async fn window_error_from_another_session_is_rejected() {
    let mut connection = window_connection().await;
    let id = connection.handshake.history_id.clone();
    connection.send_internal_error(&id, "another-session").await;
    let reply = connection.client.recv(WAIT).await.expect("error reply");
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["code"], "SESSION_MISMATCH");
    assert!(!connection.harness.events.has_event("history-unavailable"));
}

#[tokio::test]
async fn error_with_an_unknown_id_still_fails_closed() {
    let mut connection = window_connection().await;
    let session = connection.handshake.session.clone();
    connection.send_internal_error("ea-1", &session).await;
    let reply = connection.client.recv(WAIT).await.expect("error reply");
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["code"], "INVALID_MESSAGE");
    assert!(!connection.harness.events.has_event("history-unavailable"));
}
