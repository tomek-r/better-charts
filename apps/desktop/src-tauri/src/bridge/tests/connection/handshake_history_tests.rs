use super::*;

#[tokio::test]
async fn invalid_reconciliation_identity_tears_down_without_relocking_session_gate() {
    let state = BridgeState::default();
    let journal = test_journal_path();
    let safety = ExecutionSafetyState::open(&journal);
    let adapter = ExecutionAdapterState::new(safety);
    let harness = start_bridge(state, adapter).await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["account_login"] = serde_json::Value::String("x".repeat(129));
    client.send(hello).await.unwrap();

    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("handshake ack precedes reconciliation request");
    assert_eq!(ack.message_type, MessageType::HelloAck);
    assert!(
        wait_until(Duration::from_secs(2), || {
            harness.state.status.lock().unwrap().state == BridgeConnectionState::ProtocolError
        })
        .await
    );
    cleanup_journal(&journal);
}

#[tokio::test]
async fn valid_history_snapshot_publishes_and_enables_quotes() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    // Answer the history request the server sent during the handshake.
    let request = handshake.history.clone();
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-1",
            Some(&session),
            serde_json::json!({
                "request_id": handshake.history_id,
                "symbol": request.symbol,
                "timeframe": request.timeframe,
                "complete": true,
                "candles": [
                    {"time_ms": 1, "open": "1.1", "high": "1.2", "low": "1.09", "close": "1.11", "tick_volume": 5, "spread": 2, "real_volume": 0}
                ]
            }),
        ))
        .await
        .unwrap();
    // With a market symbol in place, matching quotes are accepted and
    // published; mismatching ones are silently dropped.
    client
        .send(BridgeClient::envelope(
            MessageType::QuoteUpdate,
            "quote-1",
            Some(&session),
            serde_json::json!({"symbol": "GBPUSD", "time_ms": 2, "bid": "1.25", "ask": "1.26", "last": "1.255", "volume": 5, "volume_real": "0", "flags": 0} ),
        ))
        .await
        .unwrap();
    client
        .send(BridgeClient::envelope(
            MessageType::QuoteUpdate,
            "quote-2",
            Some(&session),
            serde_json::json!({"symbol": "EURUSD", "time_ms": 3, "bid": "1.105", "ask": "1.107", "last": "1.106", "volume": 10, "volume_real": "0", "flags": 0} ),
        ))
        .await
        .unwrap();
    // Nothing here answers on the wire, so wait for the server task's
    // observable effects: the snapshot applied, its slot cleared, and the
    // matching quote published.
    let processed = wait_until(Duration::from_secs(2), || {
        harness.events.has_event("market-snapshot")
            && harness
                .state
                .market
                .lock()
                .expect("market mutex poisoned")
                .symbol
                .as_deref()
                == Some("EURUSD")
            && harness
                .state
                .expected_history
                .lock()
                .expect("history mutex poisoned")
                .is_none()
            && harness.events.quote_count("EURUSD") == 1
    })
    .await;
    assert!(processed, "snapshot applied and matching quote published");
    assert_eq!(
        harness.events.quote_count("GBPUSD"),
        0,
        "only the symbol-matching quote publishes"
    );
    // After a filled order consumes margin, MT5 can report a deficit. This
    // account observation must not tear down the session or clear its bars.
    client
        .send(BridgeClient::envelope(
            MessageType::AccountSnapshot,
            "account-deficit",
            Some(&session),
            serde_json::json!({
                "account_login": "001234", "broker_server": "Broker-Demo", "currency": "USD",
                "balance": "100", "equity": "99", "margin": "100", "free_margin": "-1",
                "margin_level": "99", "leverage": 100, "margin_mode": 0,
                "trade_allowed": true, "expert_allowed": true
            }),
        ))
        .await
        .unwrap();
    assert!(
        wait_until(Duration::from_secs(2), || {
            harness
                .state
                .account
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|account| account.free_margin == "-1")
        })
        .await
    );
    assert_eq!(
        harness.state.current_session.lock().unwrap().as_deref(),
        Some(session.as_str())
    );
    assert_eq!(harness.state.market.lock().unwrap().candles.len(), 1);
    client.send(BridgeClient::envelope(
        MessageType::Heartbeat, "heartbeat-after-deficit", Some(&session),
        serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
    )).await.unwrap();
    assert_eq!(
        client
            .recv(Duration::from_secs(2))
            .await
            .unwrap()
            .message_type,
        MessageType::HeartbeatAck
    );
}

#[tokio::test]
async fn stale_history_snapshot_is_ignored_without_closing() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    // The snapshot answers a request id the server never sent: stale.
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-1",
            Some(&session),
            serde_json::json!({
                "request_id": "rust-history-not-sent",
                "symbol": "EURUSD",
                "timeframe": "M1",
                "complete": true,
                "candles": []
            }),
        ))
        .await
        .unwrap();
    // Nothing is published and the connection must still accept heartbeats.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-1",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("still alive after stale snapshot");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    // Receiving the ack proves the server already processed the stale
    // snapshot (connection data is in-order). The handshake publishes one
    // default market snapshot, so assert on content, not presence: the stale
    // answer must not have filled in a symbol.
    assert!(harness
        .events
        .events()
        .iter()
        .filter(|(event, _)| event == "market-snapshot")
        .all(|(_, payload)| payload["symbol"].is_null()));
}

#[tokio::test]
async fn handshake_success_establishes_session() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    assert_eq!(
        handshake.transfer_limits,
        trading_core::protocol::TransferLimits::default()
    );
    let session = handshake.session.clone();
    assert!(!session.is_empty());
    assert!(harness.events.has_event("bridge-status"));
    assert!(
        harness
            .state
            .status
            .lock()
            .expect("status mutex poisoned")
            .terminal
            .as_deref()
            == Some("terminal-1")
    );
    // The connection stays alive: a heartbeat round-trips.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-1",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("heartbeat ack");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
}

#[tokio::test]
async fn session_mismatch_closes_connection() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let _ = complete_handshake(&mut client, &harness).await;
    // Data for a different session is a protocol error, not a stale drop.
    client
        .send(BridgeClient::envelope(
            MessageType::QuoteUpdate,
            "quote-1",
            Some("someone-else"),
            serde_json::json!({"symbol": "EURUSD", "time_ms": 1, "bid": "1.1", "ask": "1.11", "last": "1.1", "volume": 0, "volume_real": "0", "flags": 0} ),
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("session mismatch error");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::SessionMismatch);
    assert!(harness
        .state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none());
}

#[tokio::test]
async fn handshake_rejects_token_mismatch() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut envelope = valid_hello(None);
    *envelope.payload.get_mut("token").unwrap() = serde_json::json!("wrong-token");
    client.send(envelope).await.unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("auth failure");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::AuthFailed);
    assert!(!payload.retryable);
}

#[tokio::test]
async fn handshake_rejects_unsupported_version() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut envelope = valid_hello(None);
    envelope.v = 999;
    client.send(envelope).await.unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("version error frame");
    assert_eq!(error.message_type, MessageType::Error);
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::UnsupportedVersion);
    assert!(!payload.retryable);
    // The server closes the connection afterwards.
    assert!(client.recv(Duration::from_secs(1)).await.is_none());
}

#[tokio::test]
async fn handshake_requires_hello() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    // A quote update cannot precede the handshake.
    client
        .send(BridgeClient::envelope(
            MessageType::QuoteUpdate,
            "quote-1",
            None,
            serde_json::json!({"symbol": "EURUSD", "time_ms": 1, "bid": "1.1", "ask": "1.11", "last": "1.1", "volume": 0, "volume_real": "0", "flags": 0} ),
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("handshake required error");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::HandshakeRequired);
    assert!(!payload.retryable);
    assert!(harness
        .events
        .events()
        .iter()
        .any(|(event, _)| event == "bridge-status"));
}

#[tokio::test]
async fn invalid_history_snapshot_closes_connection() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    // Answer the handshake's history request with a different symbol: valid
    // framing, invalid semantics.
    let snapshot = serde_json::json!({
        "request_id": handshake.history_id,
        "symbol": "GBPUSD",
        "timeframe": handshake.history.timeframe,
        "complete": true,
        "candles": []
    });
    client
        .send(BridgeClient::envelope(
            MessageType::HistorySnapshot,
            "snap-1",
            Some(&session),
            snapshot,
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("invalid message error");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::InvalidMessage);
    assert!(harness
        .state
        .current_session
        .lock()
        .expect("session mutex poisoned")
        .is_none());
}

#[tokio::test]
async fn handshake_publishes_peer_timeframes() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["supported_timeframes"] = serde_json::json!(["MN1", "M2", "M1"]);
    complete_handshake_with_hello(&mut client, hello).await;
    assert_eq!(
        harness.state.status.lock().unwrap().supported_timeframes,
        ["M1", "M2", "MN1"]
    );
    assert!(harness.events.events().iter().any(|(event, payload)| {
        event == "bridge-status"
            && payload["supportedTimeframes"] == serde_json::json!(["M1", "M2", "MN1"])
    }));
}

#[tokio::test]
async fn handshake_rejects_invalid_timeframe_capabilities() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["supported_timeframes"] = serde_json::json!(["M1", "M7"]);
    client.send(hello).await.unwrap();
    let reply = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["code"], "INVALID_MESSAGE");
    assert!(harness.state.current_session.lock().unwrap().is_none());
}

#[tokio::test]
async fn handshake_requires_timeframe_capabilities() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello
        .payload
        .as_object_mut()
        .unwrap()
        .remove("supported_timeframes");
    client.send(hello).await.unwrap();
    let reply = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(reply.message_type, MessageType::Error);
    let message = "MT5 bridge sent an invalid connection handshake. Recompile and reattach BetterChartsBridge in MT5.";
    assert_eq!(reply.payload["message"], message);
    assert!(
        wait_until(Duration::from_secs(1), || {
            harness.state.status.lock().unwrap().message.as_deref() == Some(message)
        })
        .await
    );
    assert!(harness.state.current_session.lock().unwrap().is_none());
}

#[tokio::test]
async fn malformed_handshake_has_actionable_copy_without_echoing_payload_values() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["terminal_build"] = serde_json::json!("private-value");
    client.send(hello).await.unwrap();
    let reply = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["message"], "MT5 bridge sent an invalid connection handshake. Recompile and reattach BetterChartsBridge in MT5.");
    assert!(harness.state.current_session.lock().unwrap().is_none());
}

/// Sends a hello whose `tick_reader_version` is set by `mutate`, plus a
/// dropped `supported_timeframes` to prove the check precedes schema parsing.
async fn tick_reader_rejection(
    mutate: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> (String, serde_json::Value, BridgeHarness) {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    let payload = hello.payload.as_object_mut().unwrap();
    payload.remove("supported_timeframes");
    mutate(payload);
    client.send(hello).await.unwrap();
    let reply = client.recv(Duration::from_secs(2)).await.unwrap();
    assert_eq!(reply.message_type, MessageType::Error);
    assert_eq!(reply.payload["code"], "UNSUPPORTED_VERSION");
    let message = reply.payload["message"].as_str().unwrap().to_owned();
    assert!(
        wait_until(Duration::from_secs(1), || {
            harness.state.status.lock().unwrap().message.as_deref() == Some(message.as_str())
        })
        .await
    );
    assert!(harness.state.current_session.lock().unwrap().is_none());
    (message, reply.payload, harness)
}

#[tokio::test]
async fn older_tick_reader_reports_required_and_installed_versions() {
    let (message, _, _harness) = tick_reader_rejection(|payload| {
        payload.insert("tick_reader_version".into(), serde_json::json!("0.9"));
    })
    .await;
    assert_eq!(message, format!("App requires MT5 tick reader version {}, but installed tick reader version is 0.9. Update BetterChartsTickHistoryReader in MQL5/Indicators, then reattach BetterChartsBridge in MT5.", trading_core::protocol::tick_reader_version()));
}

#[tokio::test]
async fn missing_null_or_malformed_tick_reader_version_is_reported_without_echo() {
    let expected = format!("App requires MT5 tick reader version {}, but the tick reader did not report a valid version. Install or update BetterChartsTickHistoryReader in MQL5/Indicators, then reattach BetterChartsBridge in MT5.", trading_core::protocol::tick_reader_version());
    let (missing, _, _h1) = tick_reader_rejection(|payload| {
        payload.remove("tick_reader_version");
    })
    .await;
    assert_eq!(missing, expected);
    let (null, _, _h2) = tick_reader_rejection(|payload| {
        payload.insert("tick_reader_version".into(), serde_json::Value::Null);
    })
    .await;
    assert_eq!(null, expected);
    let (malformed, _, _h3) = tick_reader_rejection(|payload| {
        payload.insert(
            "tick_reader_version".into(),
            serde_json::json!("secret-<script>"),
        );
    })
    .await;
    assert_eq!(malformed, expected);
    assert!(!malformed.contains("secret"));
}

#[tokio::test]
async fn ea_version_is_checked_before_tick_reader_version() {
    let (message, _, _harness) = {
        let harness = default_harness().await;
        let mut client = BridgeClient::connect(harness.addr).await.unwrap();
        let mut hello = valid_hello(None);
        hello.payload["expert_version"] = serde_json::json!("0.6.0");
        hello
            .payload
            .as_object_mut()
            .unwrap()
            .remove("tick_reader_version");
        client.send(hello).await.unwrap();
        let reply = client.recv(Duration::from_secs(2)).await.unwrap();
        (
            reply.payload["message"].as_str().unwrap().to_owned(),
            reply.payload,
            harness,
        )
    };
    assert!(message.starts_with("App requires MT5 bridge version"));
}

#[tokio::test]
async fn matching_tick_reader_version_completes_the_handshake() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    assert!(!handshake.session.is_empty());
}

#[tokio::test]
async fn older_ea_reports_required_and_installed_versions_before_schema_validation() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["expert_version"] = serde_json::json!("0.6.0");
    hello
        .payload
        .as_object_mut()
        .unwrap()
        .remove("supported_timeframes");
    client.send(hello).await.unwrap();
    let reply = client.recv(Duration::from_secs(2)).await.unwrap();
    let message = format!("App requires MT5 bridge version {}, but installed bridge version is 0.6.0. Update and reattach BetterChartsBridge in MT5.", trading_core::protocol::expert_adviser_version());
    assert_eq!(reply.payload["code"], "UNSUPPORTED_VERSION");
    assert_eq!(reply.payload["message"], message);
    assert!(
        wait_until(Duration::from_secs(1), || {
            harness.state.status.lock().unwrap().message.as_deref() == Some(message.as_str())
        })
        .await
    );
    assert!(harness.state.current_session.lock().unwrap().is_none());
}
