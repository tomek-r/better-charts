use super::*;

/// Accepts `sessions` sequential connections, numbering them like `run_server`.
pub(super) async fn start_sequential_bridge(
    state: BridgeState,
    adapter: ExecutionAdapterState,
    sessions: u64,
) -> BridgeHarness {
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
        for session_number in 1..=sessions {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(handle_connection(
                stream,
                events_dyn.clone(),
                state.clone(),
                adapter.clone(),
                token.clone(),
                session_number,
            ));
        }
    });
    harness
}

fn account_intent(id: &str, account_login: &str) -> ExecutionIntent {
    ExecutionIntent::new(
        id.to_owned(),
        account_login.to_owned(),
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

/// An MT5 login switch makes the EA reconnect with a new `hello`. The new
/// account's session must reach the same ready state as a fresh app start:
/// handshake accepted, reconciliation complete, and an order bound to the new
/// account dispatched to the new connection.
#[tokio::test]
async fn account_switch_reconnect_reaches_ready_and_dispatches_for_new_account() {
    let journal = test_journal_path();
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::open(&journal));
    let harness = start_sequential_bridge(BridgeState::default(), adapter.clone(), 2).await;

    let mut old_client = BridgeClient::connect(harness.addr).await.unwrap();
    let old = complete_handshake(&mut old_client, &harness).await;
    old_client
        .send(BridgeClient::envelope(
            MessageType::ReconcileSnapshot,
            "recon-old",
            Some(&old.session),
            serde_json::to_value(complete_reconcile_snapshot(&old.reconcile)).unwrap(),
        ))
        .await
        .unwrap();

    let mut new_client = BridgeClient::connect(harness.addr).await.unwrap();
    let mut hello = valid_hello(None);
    hello.payload["account_login"] = serde_json::json!("009999");
    let fresh = complete_handshake_with_hello(&mut new_client, hello).await;
    assert_ne!(fresh.session, old.session);
    assert_eq!(fresh.reconcile.account_login, "009999");
    new_client
        .send(BridgeClient::envelope(
            MessageType::ReconcileSnapshot,
            "recon-new",
            Some(&fresh.session),
            serde_json::to_value(complete_reconcile_snapshot(&fresh.reconcile)).unwrap(),
        ))
        .await
        .unwrap();

    let command_id = "cmd-new-account".to_owned();
    let status = harness.state.status.lock().unwrap().clone();
    assert_eq!(status.account.as_deref(), Some("009999"));
    assert!(
        wait_until(Duration::from_secs(2), || {
            harness
                .state
                .reconciliation_status
                .lock()
                .unwrap()
                .account_login
                .as_deref()
                == Some("009999")
                && harness.state.reconciliation_status.lock().unwrap().state
                    == ReconciliationStateKind::Complete
        })
        .await,
        "reconciliation must complete for the new account"
    );
    adapter
        .enqueue_for_session(
            &fresh.session,
            PendingCommand {
                command_id: command_id.clone(),
                message_type: MessageType::OrderSubmitRequest,
                payload: serde_json::json!({ "command_id": command_id }),
            },
            Some(account_intent(&command_id, "009999")),
            1,
        )
        .expect("queue command for the new account");
    harness.state.wake_outbound();
    let dispatch = loop {
        let message = new_client
            .recv(Duration::from_secs(5))
            .await
            .expect("order frame on the new session");
        if message.message_type == MessageType::OrderSubmitRequest {
            break message;
        }
    };
    assert_eq!(dispatch.id, command_id);
    cleanup_journal(&journal);
}
