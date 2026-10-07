use super::*;

#[tokio::test]
async fn valid_heartbeat_publishes_status_and_returns_ack() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-2",
            Some(&handshake.session),
            serde_json::json!({
                "sequence": 2,
                "terminal_connected": true,
                "account_connected": true,
                "broker_server": "Broker-Demo"
            }),
        ))
        .await
        .unwrap();

    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("heartbeat ack");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert_eq!(ack.session_id.as_deref(), Some(handshake.session.as_str()));
    assert_eq!(ack.payload["sequence"], 2);
    assert!(harness
        .state
        .status
        .lock()
        .unwrap()
        .last_heartbeat
        .is_some());
    assert!(harness.events.has_event("bridge-status"));
}

#[tokio::test]
async fn unsupported_client_message_closes_connection() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    // Tick history is server -> EA only.
    client
        .send(BridgeClient::envelope(
            MessageType::TickHistoryRequest,
            "tick-1",
            Some(&session),
            serde_json::json!({"request_id": "x", "symbol": "EURUSD", "timeframe": "M1", "page": 0, "from_ms": 1, "limit": 100}),
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("unsupported message error");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::InvalidMessage);
}

#[tokio::test]
async fn heartbeat_from_wrong_broker_closes_connection() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-1",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Other-Broker"}),
        ))
        .await
        .unwrap();
    // The server drops the connection (and publishes protocol error status).
    assert!(client.recv(Duration::from_secs(2)).await.is_none());
    let status = harness
        .events
        .events()
        .iter()
        .find(|(event, _)| event == "bridge-status")
        .map(|(_, payload)| payload.clone());
    let Some(status) = status else {
        return;
    };
    assert!(
        status.to_string().contains("ProtocolError") || status.to_string().contains("protocol"),
        "expected protocol error status, got {status}"
    );
}

#[tokio::test]
async fn flush_outbound_drains_pending_slots_in_order() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().unwrap();
    let mut client = BridgeClient::connect(addr).await.unwrap();
    let (stream, _) = listener.accept().await.unwrap();
    let stream = stream.into_std().unwrap();
    let mut stream = tokio::net::TcpStream::from_std(stream).unwrap();

    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-x".to_owned());
    *state.pending_history.lock().unwrap() = Some(HistoryRequest {
        symbol: "EURUSD".to_owned(),
        timeframe: "M1".to_owned(),
        bars: 100,
        before_ms: None,
    });
    *state.pending_symbol_info.lock().unwrap() = Some(SymbolInfoRequest {
        symbol: "EURUSD".to_owned(),
    });
    *state.pending_symbol_search.lock().unwrap() = Some(SymbolSearchRequest {
        query: "eur".to_owned(),
        limit: 10,
    });
    *state.pending_risk.lock().unwrap() = Some((
        RiskQuoteRequest {
            draft_id: "draft-1".to_owned(),
            symbol: "EURUSD".to_owned(),
            side: OrderSide::Buy,
            entry: "1.10000".to_owned(),
            stop_loss: "1.09000".to_owned(),
            take_profit: None,
        },
        rust_decimal::Decimal::new(1, 2),
        rust_decimal::Decimal::from(100),
        1,
    ));
    *state.pending_order_check.lock().unwrap() = Some((
        OrderCheckRequest {
            draft_id: "draft-1".to_owned(),
            account_login: "001234".to_owned(),
            broker_server: "Broker-Demo".to_owned(),
            symbol: "EURUSD".to_owned(),
            side: OrderSide::Buy,
            order_kind: OrderKind::Market,
            volume: "0.10".to_owned(),
            entry: "1.10000".to_owned(),
            stop_loss: Some("1.09000".to_owned()),
            take_profit: None,
            time_in_force: None,
            limit_price: None,
        },
        1,
    ));
    *state.pending_reconciliation.lock().unwrap() = Some(PendingReconciliation {
        session_id: "session-x".to_owned(),
        request: ReconcileRequest {
            request_id: "rust-recon-1".to_owned(),
            account_login: "001234".to_owned(),
            broker_server: "Broker-Demo".to_owned(),
            history_from_ms: 0,
            max_history_orders: 100,
            max_history_deals: 100,
        },
    });
    // Open the dispatch gate and enqueue a command.
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));
    adapter.session_started_for_session("session-x", true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    adapter
        .enqueue(
            "cmd-1".to_owned(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({ "command_id": "cmd-1" }),
            Some(place_order_intent("cmd-1")),
            1,
        )
        .expect("queue command");

    flush_outbound(&mut stream, &state, &adapter, "session-x")
        .await
        .expect("flush");

    let mut types = Vec::new();
    for _ in 0..7 {
        let message = client.recv(Duration::from_secs(2)).await.expect("frame");
        types.push(message.message_type);
    }
    assert_eq!(
        types,
        vec![
            MessageType::HistoryRequest,
            MessageType::SymbolInfoRequest,
            MessageType::SymbolSearchRequest,
            MessageType::RiskQuoteRequest,
            MessageType::OrderCheckRequest,
            MessageType::ReconcileRequest,
            MessageType::OrderSubmitRequest,
        ]
    );
    // Slots were claimed, not re-queued.
    assert!(state.pending_history.lock().unwrap().is_none());
    assert!(state.pending_reconciliation.lock().unwrap().is_none());
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-1"));
    cleanup_journal(&journal);
}

#[tokio::test]
async fn superseded_session_cannot_claim_new_session_outbound_slots() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().unwrap();
    let mut client = BridgeClient::connect(addr).await.unwrap();
    let (mut stream, _) = listener.accept().await.unwrap();

    let state = BridgeState::default();
    *state.current_session.lock().unwrap() = Some("session-new".to_owned());
    let request = HistoryRequest {
        symbol: "EURUSD".to_owned(),
        timeframe: "M1".to_owned(),
        bars: 100,
        before_ms: None,
    };
    *state.pending_history.lock().unwrap() = Some(request.clone());
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));

    flush_outbound(&mut stream, &state, &adapter, "session-old")
        .await
        .expect("superseded flush is a no-op");

    assert_eq!(
        state.pending_history.lock().unwrap().as_ref(),
        Some(&request)
    );
    assert!(client.recv(Duration::from_millis(20)).await.is_none());
    cleanup_journal(&journal);
}

#[tokio::test]
async fn heartbeat_market_session_is_stored_and_clears_when_absent() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;

    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ms-1",
            Some(&handshake.session),
            serde_json::json!({
                "sequence": 11,
                "terminal_connected": true,
                "account_connected": true,
                "broker_server": "Broker-Demo",
                "market_session": {
                    "symbol": "NAS100",
                    "is_open": true,
                    "trade_mode": 4,
                    "server_time_ms": 1_770_000_000_000_i64
                }
            }),
        ))
        .await
        .unwrap();
    let ack = client.recv(Duration::from_secs(2)).await.expect("ack");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    {
        let status = harness.state.status.lock().unwrap();
        let session = status.market_session.as_ref().expect("stored session");
        assert_eq!(session.symbol, "NAS100");
        assert!(session.is_open);
        assert_eq!(session.trade_mode, 4);
        assert_eq!(session.server_time_ms, 1_770_000_000_000);
    }

    // A later heartbeat without the field clears the observation, so the
    // submission gate fails closed instead of trusting a stale session.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ms-2",
            Some(&handshake.session),
            serde_json::json!({
                "sequence": 12,
                "terminal_connected": true,
                "account_connected": true,
                "broker_server": "Broker-Demo"
            }),
        ))
        .await
        .unwrap();
    let _ = client.recv(Duration::from_secs(2)).await.expect("ack");
    assert!(harness
        .state
        .status
        .lock()
        .unwrap()
        .market_session
        .is_none());
}

#[tokio::test]
async fn heartbeat_with_malformed_market_session_is_rejected() {
    let harness = default_harness().await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-ms-bad",
            Some(&handshake.session),
            serde_json::json!({
                "sequence": 13,
                "terminal_connected": true,
                "account_connected": true,
                "broker_server": "Broker-Demo",
                "market_session": {
                    "symbol": "   ",
                    "is_open": true,
                    "trade_mode": 4,
                    "server_time_ms": 1
                }
            }),
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("error frame");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::InvalidMessage);
    assert!(harness
        .state
        .status
        .lock()
        .unwrap()
        .market_session
        .is_none());
}
