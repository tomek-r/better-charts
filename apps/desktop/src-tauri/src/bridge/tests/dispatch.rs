//! Execution dispatch gate, submit validation and journaling tests.
use super::common::*;
use super::*;

fn temp_safety_journal() -> (std::path::PathBuf, ExecutionSafetyState) {
    static NEXT_TEMP_JOURNAL: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "save-validated-{}-{}-{}.bin",
        std::process::id(),
        now_ms(),
        NEXT_TEMP_JOURNAL.fetch_add(1, Ordering::Relaxed)
    ));
    let safety = ExecutionSafetyState::open(&path);
    (path, safety)
}

fn temp_adapter_state() -> (std::path::PathBuf, ExecutionAdapterState) {
    let (path, safety) = temp_safety_journal();
    let adapter = ExecutionAdapterState::new(safety);
    adapter.session_started_for_session("session-1", true, "123", "Demo");
    (path, adapter)
}

#[test]
fn app_permission_rejects_all_four_submissions_without_journaling() {
    let bridge = ready_state_with_result(order_check_result_for_test());
    let (path, safety) = temp_safety_journal();
    let adapter = ExecutionAdapterState::new_with_trading_permission(safety.clone(), false);
    adapter.session_started_for_session("session-1", true, "123", "Demo");
    adapter.set_reconciliation_complete(true);
    let errors = [
        submit_order_inner(
            &bridge,
            &adapter,
            "draft-7-1".into(),
            "123".into(),
            "Demo".into(),
            "NAS".into(),
            "buy".into(),
            "limit".into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            None,
            None,
        )
        .unwrap_err(),
        modify_order_inner(
            &bridge,
            &adapter,
            "123".into(),
            "Demo".into(),
            "pending_order".into(),
            "7001".into(),
            Some("99".into()),
            None,
            None,
        )
        .unwrap_err(),
        close_position_inner(
            &bridge,
            &adapter,
            "123".into(),
            "Demo".into(),
            "9001".into(),
            None,
        )
        .unwrap_err(),
        cancel_order_inner(
            &bridge,
            &adapter,
            "123".into(),
            "Demo".into(),
            "7001".into(),
        )
        .unwrap_err(),
    ];
    for error in errors {
        assert_eq!(
            error,
            "trading is disabled in app settings; restart after enabling it"
        );
    }
    assert_eq!(adapter.queue_status().pending, 0);
    assert!(safety.recovery_snapshot().unwrap().1.is_empty());
    assert!(adapter.next_wire_message_for_session("session-1").is_none());
    let _ = std::fs::remove_file(path);
}

#[test]
fn dispatch_gate_passes_all_four_execution_commands_into_the_queue() {
    let bridge = ready_state_with_result(order_check_result_for_test());
    let outbound_rx = bridge.outbound_signal.subscribe();
    let (path, adapter) = temp_adapter_state();

    // Owner-approved unlock (2026-09-23): the production gate passes, so
    // a submission falls through into validation instead of being
    // rejected up front.
    assert!(dispatch_gate().is_ok());
    assert_eq!(
        submit_order_inner(
            &bridge,
            &adapter,
            "draft-7-1".into(),
            "999".into(),
            "Demo".into(),
            "NAS".into(),
            "buy".into(),
            "limit".into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            None,
            None,
        )
        .unwrap_err(),
        "requested account does not match account snapshot",
        "the gate opens into validation, not into blind queueing"
    );
    assert_eq!(adapter.queue_status().pending, 0);

    // All four execution commands pass the gate and reach the durable
    // journal plus the bounded queue.
    submit_order_inner(
        &bridge,
        &adapter,
        "draft-7-1".into(),
        "123".into(),
        "Demo".into(),
        "NAS".into(),
        "buy".into(),
        "limit".into(),
        "0.1".into(),
        "100".into(),
        Some("90".into()),
        None,
        None,
        None,
    )
    .unwrap();
    modify_order_inner(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "pending_order".into(),
        "7001".into(),
        Some("99".into()),
        None,
        None,
    )
    .unwrap();
    close_position_inner(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "9001".into(),
        None,
    )
    .unwrap();
    cancel_order_inner(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "7001".into(),
    )
    .unwrap();

    let status = adapter.queue_status();
    assert_eq!(
        status.pending, 4,
        "each command queues behind the open gate"
    );
    assert!(
        outbound_rx.has_changed().unwrap(),
        "queueing execution work wakes the socket loop without a heartbeat"
    );
    assert!(
        status.dispatch_enabled,
        "the queue view reports the open gate"
    );
    let value = serde_json::to_value(adapter.queue_status()).unwrap();
    assert_eq!(value["pending"], 4);
    assert!(value["inFlight"].is_null());
    assert_eq!(
        value["dispatchEnabled"],
        crate::execution_adapter::DISPATCH_ENABLED
    );
    assert_eq!(value["stranded"], 0);

    // Each queued command registered a durable intent in the journal.
    drop(adapter);
    let replayed = crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    assert_eq!(replayed.command_count().unwrap(), 4);
    let _ = std::fs::remove_file(path);
}

#[test]
fn command_producer_cannot_validate_before_session_replacement_and_enqueue_afterward() {
    let bridge = ready_state_with_result(order_check_result_for_test());
    let (path, adapter) = temp_adapter_state();
    let session_work = bridge.session_work.lock().unwrap();
    let producer_bridge = bridge.clone();
    let producer_adapter = adapter.clone();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let producer = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        queue_cancel_order(
            &producer_bridge,
            &producer_adapter,
            "123".into(),
            "Demo".into(),
            "7001".into(),
        )
    });
    started_rx.recv().unwrap();

    // Replacing the session while the producer is waiting on the shared gate
    // makes its later account validation fail before adapter enqueue.
    *bridge.current_session.lock().unwrap() = None;
    adapter.session_closed();
    drop(session_work);

    assert_eq!(
        producer.join().unwrap().unwrap_err(),
        "bridge is not connected"
    );
    assert_eq!(adapter.queue_status().pending, 0);
    drop(adapter);
    let journal = crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    assert_eq!(journal.command_count().unwrap(), 0);
    let _ = std::fs::remove_file(path);
}

#[test]
fn submission_validation_precedes_registration_and_queueing() {
    let (path, adapter) = temp_adapter_state();

    // Session checks come before any queueing or durable write.
    let disconnected = BridgeState::with_symbol_cache_path(None);
    assert_eq!(
        queue_submit_order(
            &disconnected,
            &adapter,
            "draft-7-1".into(),
            "123".into(),
            "Demo".into(),
            "NAS".into(),
            "buy".into(),
            "limit".into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            None,
            None,
        )
        .unwrap_err(),
        "bridge is not connected"
    );
    assert_eq!(adapter.queue_status().pending, 0);

    let bridge = ready_state_with_result(order_check_result_for_test());
    // Account identity, chart symbol, and payload geometry are validated.
    assert!(queue_submit_order(
        &bridge,
        &adapter,
        "draft-7-1".into(),
        "999".into(),
        "Demo".into(),
        "NAS".into(),
        "buy".into(),
        "limit".into(),
        "0.1".into(),
        "100".into(),
        Some("90".into()),
        None,
        None,
        None,
    )
    .is_err());
    assert_eq!(
        queue_submit_order(
            &bridge,
            &adapter,
            "draft-7-1".into(),
            "123".into(),
            "Demo".into(),
            "EURUSD".into(),
            "buy".into(),
            "limit".into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            None,
            None,
        )
        .unwrap_err(),
        "order symbol does not match active chart"
    );
    assert!(queue_submit_order(
        &bridge,
        &adapter,
        "draft-7-1".into(),
        "123".into(),
        "Demo".into(),
        "NAS".into(),
        "buy".into(),
        "limit".into(),
        "not-a-number".into(),
        "100".into(),
        Some("90".into()),
        None,
        None,
        None,
    )
    .is_err());
    // A price on a position target is rejected by the wire contract.
    assert!(queue_modify_order(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "position".into(),
        "9001".into(),
        Some("90".into()),
        None,
        Some("99".into()),
    )
    .is_err());
    assert_eq!(
        adapter.queue_status().pending,
        0,
        "no invalid command queues"
    );

    // A valid submit/close/cancel validates, registers durably, and
    // enqueues; the rejected modify never reaches the queue.
    queue_submit_order(
        &bridge,
        &adapter,
        "draft-7-1".into(),
        "123".into(),
        "Demo".into(),
        "NAS".into(),
        "buy".into(),
        "limit".into(),
        "0.1".into(),
        "100".into(),
        Some("90".into()),
        None,
        None,
        None,
    )
    .unwrap();
    queue_close_position(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "9001".into(),
        None,
    )
    .unwrap();
    queue_cancel_order(
        &bridge,
        &adapter,
        "123".into(),
        "Demo".into(),
        "7001".into(),
    )
    .unwrap();
    assert_eq!(adapter.queue_status().pending, 3);

    let journal_path = path.clone();
    drop(adapter);
    let replayed = crate::execution_journal::ExecutionJournal::open(&journal_path).unwrap();
    assert_eq!(
        replayed.command_count().unwrap(),
        3,
        "submit, close, and cancel each register a registry intent"
    );
    let _ = std::fs::remove_file(path);
}

#[test]
fn submit_without_stop_loss_queues_and_journals_null() {
    let bridge = ready_state_with_result(order_check_result_for_test());
    let (path, adapter) = temp_adapter_state();
    // Absent stop_loss = no SL level: the submission validates, queues,
    // and journals `null` (the modify path's null-means-unchanged rule is
    // a different command and is untouched).
    queue_submit_order(
        &bridge,
        &adapter,
        "draft-7-1".into(),
        "123".into(),
        "Demo".into(),
        "NAS".into(),
        "buy".into(),
        "market".into(),
        "0.1".into(),
        "100".into(),
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(adapter.queue_status().pending, 1);
    drop(adapter);

    let orders = journaled_place_orders(&path);
    assert_eq!(orders.len(), 1);
    assert!(
        orders[0]["stop_loss"].is_null(),
        "an absent stop_loss journals as null: {}",
        orders[0]
    );
    crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn parse_time_in_force_maps_wire_values_and_rejects_unknown_ones() {
    assert_eq!(parse_time_in_force(None).unwrap(), None);
    assert_eq!(
        parse_time_in_force(Some("gtc".into())).unwrap(),
        Some(TimeInForce::Gtc)
    );
    assert_eq!(
        parse_time_in_force(Some("day".into())).unwrap(),
        Some(TimeInForce::Day)
    );
    assert_eq!(
        parse_time_in_force(Some("ioc".into())).unwrap(),
        Some(TimeInForce::Ioc)
    );
    assert_eq!(
        parse_time_in_force(Some("fok".into())).unwrap(),
        Some(TimeInForce::Fok)
    );
    assert_eq!(
        parse_time_in_force(Some("GTC".into())).unwrap_err(),
        "time_in_force must be gtc, day, ioc, or fok"
    );
    assert_eq!(
        parse_time_in_force(Some("".into())).unwrap_err(),
        "time_in_force must be gtc, day, ioc, or fok"
    );
}

/// Raw-frame scan of the append-only journal: every journaled
/// `place_order` operation payload, in file order.
fn journaled_place_orders(path: &Path) -> Vec<serde_json::Value> {
    let bytes = std::fs::read(path).unwrap();
    let mut orders = Vec::new();
    let mut cursor = 0usize;
    while cursor + 4 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let payload: serde_json::Value =
            serde_json::from_slice(&bytes[cursor..cursor + length]).unwrap();
        cursor += length;
        if payload.get("kind").and_then(|kind| kind.as_str()) == Some("register") {
            orders.push(payload["intent"]["operation"]["place_order"].clone());
        }
    }
    orders
}

#[test]
fn stop_limit_submit_with_time_in_force_validates_and_journals_both_fields() {
    let bridge = ready_state_with_result(order_check_result_for_test());
    let (path, adapter) = temp_adapter_state();
    let submit = |order_kind: &str,
                  time_in_force: Option<String>,
                  limit_price: Option<String>,
                  adapter: &ExecutionAdapterState| {
        queue_submit_order(
            &bridge,
            adapter,
            "draft-7-1".into(),
            "123".into(),
            "Demo".into(),
            "NAS".into(),
            "buy".into(),
            order_kind.into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            time_in_force,
            limit_price,
        )
    };

    // Rejected combinations never reach the journal or the queue.
    assert_eq!(
        submit("stop_limit", None, None, &adapter).unwrap_err(),
        "stop_limit requires limit_price (resting limit price)"
    );
    assert_eq!(
        submit("limit", Some("eod".into()), None, &adapter).unwrap_err(),
        "time_in_force must be gtc, day, ioc, or fok"
    );
    assert_eq!(
        submit(
            "stop_limit",
            Some("ioc".into()),
            Some("not-a-number".into()),
            &adapter
        )
        .unwrap_err(),
        "limit_price must be a positive decimal"
    );
    assert_eq!(adapter.queue_status().pending, 0);

    // A valid stop_limit submit journals kind + both new fields…
    submit(
        "stop_limit",
        Some("ioc".into()),
        Some("101".into()),
        &adapter,
    )
    .unwrap();
    // …while an absent-field submit stays today's payload (queues too).
    submit("limit", None, None, &adapter).unwrap();
    assert_eq!(adapter.queue_status().pending, 2);
    drop(adapter);

    let orders = journaled_place_orders(&path);
    assert_eq!(orders.len(), 2);
    assert_eq!(orders[0]["kind"], "stop_limit");
    assert_eq!(orders[0]["time_in_force"], "ioc");
    assert_eq!(orders[0]["limit_price"], "101");
    assert_eq!(orders[1]["kind"], "limit");
    assert!(orders[1].get("time_in_force").is_none());
    assert!(orders[1].get("limit_price").is_none());
    let _ = std::fs::remove_file(path);
}

#[test]
fn order_submit_requires_an_open_market_session_for_the_active_symbol() {
    fn try_submit(bridge: &BridgeState, adapter: &ExecutionAdapterState) -> Result<(), String> {
        submit_order_inner(
            bridge,
            adapter,
            "draft-7-1".into(),
            "123".into(),
            "Demo".into(),
            "NAS".into(),
            "buy".into(),
            "limit".into(),
            "0.1".into(),
            "100".into(),
            Some("90".into()),
            None,
            None,
            None,
        )
    }

    fn session(symbol: &str, is_open: bool) -> MarketSessionView {
        MarketSessionView {
            symbol: symbol.into(),
            is_open,
            trade_mode: 4,
            server_time_ms: 1_770_000_000_000,
        }
    }

    let (path, adapter) = temp_adapter_state();

    // Unknown session (older EA, or before the first session-bearing heartbeat).
    let unknown = ready_state_with_result(order_check_result_for_test());
    unknown.status.lock().unwrap().market_session = None;
    assert_eq!(
        try_submit(&unknown, &adapter).unwrap_err(),
        "market session is unavailable"
    );

    // Weekend / outside trading hours: the EA reports the session closed.
    let closed = ready_state_with_result(order_check_result_for_test());
    closed.status.lock().unwrap().market_session = Some(session("NAS", false));
    assert_eq!(
        try_submit(&closed, &adapter).unwrap_err(),
        "market is closed for this symbol"
    );

    // The observation belongs to a different symbol than the order.
    let other = ready_state_with_result(order_check_result_for_test());
    other.status.lock().unwrap().market_session = Some(session("EURUSD", true));
    assert_eq!(
        try_submit(&other, &adapter).unwrap_err(),
        "market session is unavailable for this symbol"
    );

    // Open session passes the gate and queues (the fixture default).
    let open = ready_state_with_result(order_check_result_for_test());
    try_submit(&open, &adapter).unwrap();
    assert_eq!(adapter.queue_status().pending, 1);

    // Only the open submit reached the durable journal.
    drop(adapter);
    let journal = crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    assert_eq!(journal.command_count().unwrap(), 1);
    let _ = std::fs::remove_file(path);
}
