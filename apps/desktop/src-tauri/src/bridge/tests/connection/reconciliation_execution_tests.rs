use super::*;

#[tokio::test]
async fn order_command_update_settles_and_releases_slot() {
    let journal = test_journal_path();
    let state = BridgeState::default();
    let safety = ExecutionSafetyState::open(&journal);
    let adapter = ExecutionAdapterState::new(safety);
    let harness = start_bridge(state.clone(), adapter.clone()).await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();

    let command_id = "cmd-1".to_owned();
    adapter
        .enqueue(
            command_id.clone(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({
                "command_id": command_id,
                "draft_id": "draft-1",
                "account_login": "001234",
                "broker_server": "Broker-Demo",
                "symbol": "EURUSD",
                "side": "buy",
                "order_kind": "market",
                "volume": "0.10",
                "entry": "1.10000"
            }),
            Some(place_order_intent(&command_id)),
            1,
        )
        .expect("queue command");
    // Reconcile first so the command dispatches.
    let reconcile = handshake.reconcile.clone();
    client
        .send(BridgeClient::envelope(
            MessageType::ReconcileSnapshot,
            "recon-1",
            Some(&session),
            serde_json::to_value(complete_reconcile_snapshot(&reconcile)).unwrap(),
        ))
        .await
        .unwrap();
    let dispatch = loop {
        let message = client.recv(Duration::from_secs(2)).await.unwrap();
        if message.message_type == MessageType::OrderSubmitRequest {
            break message;
        }
    };
    assert_eq!(dispatch.id, command_id);

    // The "EA" walks the command through its real lifecycle. The registry
    // refuses a `prepared` command that jumps straight to `filled` (the
    // accepted state may only move to `dispatching` or `unknown`), so every
    // step must arrive before the settled one; each carries a fresher
    // `at_update` than the last.
    // Timestamps are explicit per step: every update must carry a fresher
    // `at_update` than the one before it.
    for (status, filled_volume, at_ms) in [
        ("accepted", serde_json::Value::Null, 1u64),
        ("dispatching", serde_json::Value::Null, 2),
        ("filled", serde_json::json!("0.10"), 3),
    ] {
        client
            .send(BridgeClient::envelope(
                MessageType::OrderCommandUpdate,
                "upd-1",
                Some(&session),
                serde_json::json!({
                    "command_id": command_id,
                    "status": status,
                    "retcode": 10009,
                    "last_error": null,
                    "broker_order_id": "777",
                    "deal_id": null,
                    "position_id": "888",
                    "filled_volume": filled_volume,
                    "message": null,
                    "updated_at_ms": at_ms,
                    "at_update": at_ms
                }),
            ))
            .await
            .unwrap();
    }
    // The updates are applied by the spawned server task, which only runs
    // while the test awaits; wait for all three observable effects.
    let settled = wait_until(Duration::from_secs(2), || {
        harness
            .events
            .events()
            .iter()
            .filter(|(event, _)| event == "execution-command-update")
            .count()
            == 3
    })
    .await;
    assert!(settled, "command updates must settle the in-flight slot");
    // In-flight slot released: a second command may now dispatch.
    let second = "cmd-2".to_owned();
    adapter
        .enqueue(
            second.clone(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({ "command_id": second }),
            Some(place_order_intent(&second)),
            1,
        )
        .expect("queue second command");
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-1",
            Some(&session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let mut dispatched_second = false;
    for _ in 0..3 {
        if let Some(message) = client.recv(Duration::from_secs(2)).await {
            if message.id == second {
                dispatched_second = true;
            }
        } else {
            break;
        }
    }
    assert!(dispatched_second, "settled command must release the slot");
    cleanup_journal(&journal);
}

#[tokio::test]
async fn account_mismatch_update_earns_invalid_message_and_keeps_session() {
    let journal = test_journal_path();
    let state = BridgeState::default();
    let safety = ExecutionSafetyState::open(&journal);
    let adapter = ExecutionAdapterState::new(safety);
    let harness = start_bridge(state.clone(), adapter).await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();
    // Register a command bound to a DIFFERENT account than the session and
    // let an update arrive for it: the F-5 binding check must reject it.
    let foreign = ExecutionIntent::new(
        "cmd-foreign",
        "999999",
        "Other-Broker",
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
    .expect("valid intent");
    harness
        .adapter
        .enqueue(
            "cmd-foreign".to_owned(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({ "command_id": "cmd-foreign" }),
            Some(foreign),
            1,
        )
        .expect("queue foreign command");
    client
        .send(BridgeClient::envelope(
            MessageType::OrderCommandUpdate,
            "upd-1",
            Some(&session),
            serde_json::json!({
                "command_id": "cmd-foreign",
                "status": "filled",
                "retcode": 10009,
                "last_error": null,
                "broker_order_id": null,
                "deal_id": null,
                "position_id": null,
                "filled_volume": null,
                "message": null,
                "updated_at_ms": 1,
                "at_update": 1
            }),
        ))
        .await
        .unwrap();
    let error = client
        .recv(Duration::from_secs(2))
        .await
        .expect("invalid message error");
    let payload: ErrorPayload = serde_json::from_value(error.payload).unwrap();
    assert_eq!(payload.code, ErrorCode::InvalidMessage);
    // The session survives a single bad update (unlike a bad snapshot).
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
        .expect("session still alive");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    cleanup_journal(&journal);
}

#[tokio::test]
async fn reconciliation_complete_opens_dispatch_gate() {
    let journal = test_journal_path();
    let state = BridgeState::default();
    let safety = ExecutionSafetyState::open(&journal);
    let adapter = ExecutionAdapterState::new(safety);
    let harness = start_bridge(state, adapter.clone()).await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let handshake = complete_handshake(&mut client, &harness).await;
    let session = handshake.session.clone();

    // Enqueue a command while the gate is closed: no wire frame.
    let command_id = "cmd-1".to_owned();
    adapter
        .enqueue(
            command_id.clone(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({ "command_id": command_id }),
            Some(place_order_intent(&command_id)),
            1,
        )
        .expect("queue command");
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
    // The claim gate is shut: nothing else may reach the wire.
    assert!(
        client.recv(Duration::from_secs(2)).await.is_none(),
        "gate must hold the command until reconciliation completes"
    );

    // Answer the reconciliation the server requested during the handshake.
    let reconcile = handshake.reconcile.clone();
    client
        .send(BridgeClient::envelope(
            MessageType::ReconcileSnapshot,
            "recon-1",
            Some(&session),
            serde_json::to_value(complete_reconcile_snapshot(&reconcile)).unwrap(),
        ))
        .await
        .unwrap();
    let dispatch = loop {
        let message = client
            .recv(Duration::from_secs(5))
            .await
            .expect("in-flight frame");
        if message.message_type == MessageType::OrderSubmitRequest {
            break message;
        }
    };
    assert_eq!(dispatch.id, command_id);
    // The handshake publishes an earlier `unavailable` status; the one that
    // follows the complete snapshot is the last in the stream.
    let events = harness.events.events();
    let view = events
        .iter()
        .rev()
        .find(|(event, _)| event == "reconciliation-status")
        .expect("reconciliation status published");
    assert_eq!(view.1.get("state"), Some(&serde_json::json!("complete")));
    cleanup_journal(&journal);
}

#[tokio::test]
async fn disabled_trading_handshake_stays_read_only_after_reconciliation() {
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));
    let harness = start_bridge(BridgeState::default(), adapter.clone()).await;
    let mut client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["trading_enabled"] = serde_json::json!(false);
    let handshake = complete_handshake_with_hello(&mut client, hello).await;
    let command_id = "disabled-trading-command".to_owned();
    adapter
        .enqueue(
            command_id.clone(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({ "command_id": command_id }),
            Some(place_order_intent(&command_id)),
            1,
        )
        .expect("queue command");
    client
        .send(BridgeClient::envelope(
            MessageType::ReconcileSnapshot,
            "recon-disabled",
            Some(&handshake.session),
            serde_json::to_value(complete_reconcile_snapshot(&handshake.reconcile)).unwrap(),
        ))
        .await
        .unwrap();
    // Read-only traffic continues after reconciliation, but the EA permission
    // remains a separate gate even though hello_ack permits server dispatch.
    client
        .send(BridgeClient::envelope(
            MessageType::Heartbeat,
            "hb-disabled",
            Some(&handshake.session),
            serde_json::json!({"sequence": 1, "terminal_connected": true, "account_connected": true, "broker_server": "Broker-Demo"}),
        ))
        .await
        .unwrap();
    let ack = client
        .recv(Duration::from_secs(2))
        .await
        .expect("heartbeat ack");
    assert_eq!(ack.message_type, MessageType::HeartbeatAck);
    assert!(client.recv(Duration::from_secs(1)).await.is_none());
    let events = harness.events.events();
    let status = events
        .iter()
        .rev()
        .find(|(event, _)| event == "reconciliation-status")
        .expect("reconciliation status");
    assert_eq!(status.1.get("state"), Some(&serde_json::json!("complete")));
    assert_eq!(adapter.queue_status().pending, 1);
    assert!(adapter.queue_status().in_flight.is_none());
    cleanup_journal(&journal);
}
