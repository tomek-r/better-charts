use super::*;
use crate::execution_journal::ExecutionJournal;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use trading_core::execution::{ExecutionOperation, OrderKind, OrderSide, PlaceOrder};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "execution-adapter-{}-{unique}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        Self(dir.join("journal.bin"))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.parent().unwrap());
    }
}

fn adapter() -> (Temp, ExecutionAdapterState) {
    let temp = Temp::new();
    let safety = ExecutionSafetyState::open(&temp.0);
    (temp, ExecutionAdapterState::new(safety))
}

/// Journal-backed adapter with a deliberately closed dispatch gate, so
/// the gate mechanism stays covered independently of the production
/// [`DISPATCH_ENABLED`] const.
fn locked_adapter() -> (Temp, ExecutionAdapterState) {
    let temp = Temp::new();
    let safety = ExecutionSafetyState::open(&temp.0);
    (temp, ExecutionAdapterState::new_with_gate(safety, false))
}

fn intent(id: &str) -> ExecutionIntent {
    ExecutionIntent::new(
        id,
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "EURUSD".into(),
            side: OrderSide::Buy,
            kind: OrderKind::Limit,
            volume: "0.10".into(),
            entry: "1.1000".into(),
            stop_loss: Some("1.0900".into()),
            take_profit: Some("1.1200".into()),
            time_in_force: None,
            limit_price: None,
        }),
    )
    .unwrap()
}

fn enqueue(adapter: &ExecutionAdapterState, id: &str) -> Result<(), ExecutionAdapterError> {
    adapter.enqueue(
        id.to_owned(),
        MessageType::OrderSubmitRequest,
        serde_json::json!({ "command_id": id }),
        Some(intent(id)),
        10,
    )
}

fn update(id: &str, at_update: u64, updated_at_ms: i64, status: &str) -> OrderCommandUpdate {
    OrderCommandUpdate {
        command_id: id.to_owned(),
        status: status.into(),
        retcode: None,
        last_error: None,
        broker_order_id: None,
        deal_id: None,
        position_id: None,
        filled_volume: None,
        message: None,
        updated_at_ms,
        at_update,
    }
}

#[test]
fn queue_accepts_thirty_two_pending_and_rejects_the_overflow() {
    let (_temp, adapter) = adapter();
    for index in 0..MAX_PENDING_COMMANDS {
        enqueue(&adapter, &format!("cmd-{index}")).unwrap();
    }
    assert_eq!(adapter.queue_status().pending, MAX_PENDING_COMMANDS);
    let overflow = enqueue(&adapter, "cmd-overflow");
    assert!(matches!(overflow, Err(ExecutionAdapterError::QueueFull)));
    let message = overflow.unwrap_err().to_string();
    assert!(
        message.contains("queue is full"),
        "overflow must report a clear error, got: {message}"
    );
    assert_eq!(adapter.queue_status().pending, MAX_PENDING_COMMANDS);
}

#[test]
fn dispatch_gate_locks_every_submission() {
    // The production const is owner-unlocked; the gate MECHANISM itself
    // stays covered through a deliberately closed-gate instance.
    let (_temp, adapter) = locked_adapter();
    assert!(
        !adapter.queue_status().dispatch_enabled,
        "the queue view must report the locked gate"
    );
    // Even with both session gates armed, a closed dispatch gate refuses
    // every claim.
    adapter.session_started(true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-locked").unwrap();
    assert!(adapter.next_wire_message().is_none());
}

#[test]
fn local_permission_rejects_registration_and_claim_even_when_session_is_ready() {
    let temp = Temp::new();
    let adapter = ExecutionAdapterState::new_with_trading_permission(
        ExecutionSafetyState::open(&temp.0),
        false,
    );
    adapter.session_started_for_session("session-1", true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    assert!(adapter.submission_gate().is_err());
    assert!(!adapter.queue_status().dispatch_enabled);
    let status = adapter.with_trading_permission(adapter.safety.status());
    assert!(!status.dispatch_enabled);
    assert!(status.message.contains("disabled in app settings"));
    assert!(matches!(
        enqueue(&adapter, "cmd-disabled"),
        Err(ExecutionAdapterError::TradingDisabled)
    ));
    assert_eq!(adapter.queue_status().pending, 0);
    let (recovery_status, entries) = adapter.safety.recovery_snapshot().unwrap();
    assert!(entries.is_empty());
    assert!(
        !adapter
            .with_trading_permission(recovery_status)
            .dispatch_enabled
    );

    // Defense in depth: even a pre-existing queue entry cannot pass the
    // immutable startup permission when the EA and reconciliation allow it.
    adapter
        .inner
        .lock()
        .unwrap()
        .queue
        .push_back(PendingCommand {
            command_id: "cmd-preexisting".into(),
            message_type: MessageType::OrderSubmitRequest,
            payload: serde_json::json!({}),
        });
    assert!(adapter.next_wire_message_for_session("session-1").is_none());
    assert_eq!(adapter.queue_status().pending, 1);
    assert!(adapter.queue_status().in_flight.is_none());
}

#[test]
fn enabled_local_permission_still_requires_handshake_and_reconciliation() {
    let temp = Temp::new();
    let adapter = ExecutionAdapterState::new_with_trading_permission(
        ExecutionSafetyState::open(&temp.0),
        true,
    );
    adapter.session_started_for_session("session-1", false, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-disabled-ea").unwrap();
    assert!(adapter.next_wire_message_for_session("session-1").is_none());
    adapter.session_started_for_session("session-2", true, "001234", "Broker-Demo");
    enqueue(&adapter, "cmd-needs-reconcile").unwrap();
    assert!(adapter.next_wire_message_for_session("session-2").is_none());
    adapter.set_reconciliation_complete(true);
    assert_eq!(
        adapter
            .next_wire_message_for_session("session-2")
            .unwrap()
            .command_id,
        "cmd-needs-reconcile"
    );
}

#[test]
fn claim_is_single_in_flight_and_settled_update_dequeues_the_next() {
    let (_temp, adapter) = adapter();
    adapter.session_started(true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-a").unwrap();
    enqueue(&adapter, "cmd-b").unwrap();

    let first = adapter.next_wire_message().expect("all gates are open");
    assert_eq!(first.command_id, "cmd-a");
    assert!(adapter.next_wire_message().is_none(), "one in flight");
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-a"));
    assert_eq!(adapter.queue_status().pending, 1);

    // Non-settled updates keep the slot busy.
    let applied = adapter
        .apply_command_update(update("cmd-a", 1, 11, "accepted"))
        .unwrap();
    assert!(applied.is_some());
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-a"));
    let applied = adapter
        .apply_command_update(update("cmd-a", 2, 12, "dispatching"))
        .unwrap();
    assert!(applied.is_some());
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-a"));

    // A settled update releases the slot; the next claim dequeues cmd-b.
    let applied = adapter
        .apply_command_update(update("cmd-a", 3, 13, "server_accepted"))
        .unwrap();
    assert!(applied.is_some());
    assert_eq!(adapter.queue_status().in_flight, None);
    let next = adapter.next_wire_message().expect("slot was released");
    assert_eq!(next.command_id, "cmd-b");
    assert_eq!(adapter.queue_status().pending, 0);
}

#[test]
fn invalid_or_stale_settled_updates_keep_the_in_flight_slot() {
    let (_temp, adapter) = adapter();
    adapter.session_started(true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-a").unwrap();
    enqueue(&adapter, "cmd-b").unwrap();
    assert_eq!(adapter.next_wire_message().unwrap().command_id, "cmd-a");

    // A settled status cannot skip the registry's required transitions.
    assert!(adapter
        .apply_command_update(update("cmd-a", 1, 11, "server_accepted"))
        .is_err());
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-a"));
    assert_eq!(adapter.queue_status().pending, 1);

    adapter
        .apply_command_update(update("cmd-a", 1, 12, "accepted"))
        .unwrap();
    adapter
        .apply_command_update(update("cmd-a", 2, 13, "dispatching"))
        .unwrap();
    // Same counter is stale even though this raw status is settled.
    assert!(adapter
        .apply_command_update(update("cmd-a", 2, 14, "server_accepted"))
        .unwrap()
        .is_none());
    assert_eq!(adapter.queue_status().in_flight.as_deref(), Some("cmd-a"));

    adapter
        .apply_command_update(update("cmd-a", 3, 15, "server_accepted"))
        .unwrap();
    assert_eq!(adapter.queue_status().in_flight, None);
    assert_eq!(adapter.next_wire_message().unwrap().command_id, "cmd-b");
}

#[test]
fn session_scoped_claim_enqueue_and_update_reject_old_session_work() {
    let (_temp, adapter) = adapter();
    adapter.session_started_for_session("session-a", true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    adapter
        .enqueue_for_session(
            "session-a",
            PendingCommand {
                command_id: "cmd-a".into(),
                message_type: MessageType::OrderSubmitRequest,
                payload: serde_json::json!({ "command_id": "cmd-a" }),
            },
            Some(intent("cmd-a")),
            10,
        )
        .unwrap();
    assert!(matches!(
        adapter.enqueue_for_session(
            "old-session",
            PendingCommand {
                command_id: "cmd-old".into(),
                message_type: MessageType::OrderSubmitRequest,
                payload: serde_json::json!({}),
            },
            None,
            11,
        ),
        Err(ExecutionAdapterError::StaleSession)
    ));
    assert!(adapter
        .next_wire_message_for_session("old-session")
        .is_none());
    assert_eq!(
        adapter
            .next_wire_message_for_session("session-a")
            .unwrap()
            .command_id,
        "cmd-a"
    );

    adapter.session_started_for_session("session-b", true, "001234", "Broker-Demo");
    assert!(matches!(
        adapter.enqueue_for_session(
            "session-a",
            PendingCommand {
                command_id: "cmd-late".into(),
                message_type: MessageType::OrderSubmitRequest,
                payload: serde_json::json!({}),
            },
            None,
            12,
        ),
        Err(ExecutionAdapterError::StaleSession)
    ));
    assert_eq!(adapter.queue_status().pending, 0);
    assert!(matches!(
        adapter.apply_command_update_for_session("session-a", update("cmd-a", 1, 11, "unknown")),
        Err(ExecutionAdapterError::StaleSession)
    ));
    assert!(matches!(
        adapter.apply_command_error_for_session(
            "session-a",
            OrderCommandError {
                command_id: "cmd-a".into(),
                code: "OLD_SESSION".into(),
                message: "old session response".into(),
            }
        ),
        Err(ExecutionAdapterError::StaleSession)
    ));
    assert_eq!(adapter.queue_status().in_flight, None);
}

#[test]
fn apply_command_update_happy_stale_and_invalid_transition_paths() {
    let (_temp, adapter) = adapter();
    enqueue(&adapter, "cmd-x").unwrap();

    // Happy path: registered command, increasing at_update.
    assert!(
        adapter
            .apply_command_update(update("cmd-x", 1, 11, "accepted"))
            .unwrap()
            .is_some(),
        "accepted is an applied EA-side confirmation"
    );
    assert!(adapter
        .apply_command_update(update("cmd-x", 2, 12, "dispatching"))
        .unwrap()
        .is_some());

    // Stale at_update is ignored without changing anything.
    assert!(adapter
        .apply_command_update(update("cmd-x", 2, 13, "filled"))
        .unwrap()
        .is_none());

    // Invalid transition (dispatching after server_accepted) is rejected
    // and the adapter keeps working: no state teardown, no poisoning.
    assert!(adapter
        .apply_command_update(update("cmd-x", 3, 14, "server_accepted"))
        .unwrap()
        .is_some());
    assert!(adapter
        .apply_command_update(update("cmd-x", 4, 15, "dispatching"))
        .is_err());
    assert!(
        adapter
            .apply_command_update(update("cmd-x", 5, 16, "filled"))
            .unwrap()
            .is_some(),
        "later legal updates still apply after a rejected one"
    );

    // Updates for unknown commands are rejected, not silently recorded.
    assert!(adapter
        .apply_command_update(update("cmd-missing", 1, 17, "accepted"))
        .is_err());
}

#[test]
fn command_error_releases_the_in_flight_slot_and_drops_queued_command() {
    let (_temp, adapter) = adapter();
    {
        let mut inner = adapter.inner.lock().unwrap();
        inner.queue.push_back(PendingCommand {
            command_id: "cmd-a".into(),
            message_type: MessageType::OrderSubmitRequest,
            payload: serde_json::json!({}),
        });
        inner.queue.push_back(PendingCommand {
            command_id: "cmd-b".into(),
            message_type: MessageType::OrderCloseRequest,
            payload: serde_json::json!({}),
        });
        inner.in_flight = Some("cmd-a".into());
    }
    adapter
        .apply_command_error(OrderCommandError {
            command_id: "cmd-a".into(),
            code: "BROKER_UNAVAILABLE".into(),
            message: "broker connection unavailable".into(),
        })
        .unwrap();
    assert_eq!(adapter.queue_status().in_flight, None);
    assert_eq!(adapter.queue_status().pending, 1);

    adapter
        .apply_command_error(OrderCommandError {
            command_id: "cmd-b".into(),
            code: "PREFLIGHT_FAILED".into(),
            message: "preflight failed".into(),
        })
        .unwrap();
    assert_eq!(adapter.queue_status().pending, 0);
}

#[test]
fn session_transitions_never_requeue_the_in_flight_command() {
    let (_temp, adapter) = adapter();
    {
        let mut inner = adapter.inner.lock().unwrap();
        inner.in_flight = Some("cmd-a".into());
    }
    adapter.session_closed();
    assert_eq!(adapter.queue_status().in_flight, None);
    assert_eq!(
        adapter.queue_status().pending,
        0,
        "a sent command is dropped from tracking, never retried automatically"
    );
}

#[test]
fn queue_status_serializes_camel_case_and_registration_survives_reopen() {
    let (temp, adapter) = adapter();
    let value = serde_json::to_value(adapter.queue_status()).unwrap();
    assert_eq!(value["pending"], 0);
    assert!(value["inFlight"].is_null());
    assert_eq!(value["dispatchEnabled"], DISPATCH_ENABLED);
    assert_eq!(value["stranded"], 0);
    assert!(value.get("in_flight").is_none());
    assert!(value.get("dispatch_enabled").is_none());
    assert!(value.get("straded").is_none());
    // The durable half of enqueue: registration survives a reopen.
    enqueue(&adapter, "cmd-persist").unwrap();
    let path = temp.0.clone();
    drop(adapter);
    let replayed = ExecutionJournal::open(&path).unwrap();
    assert_eq!(replayed.command_count().unwrap(), 1);
}

/// Raw-frame scan for `QueueDropped { command_ids }` records: the journal
/// keeps no in-memory projection of audit-only events, so the durable
/// proof is read straight from the append-only file.
fn queue_dropped_ids(path: &std::path::Path) -> Vec<Vec<String>> {
    let bytes = fs::read(path).unwrap();
    let mut dropped = Vec::new();
    let mut cursor = 0usize;
    while cursor + 4 <= bytes.len() {
        let length = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let payload: serde_json::Value =
            serde_json::from_slice(&bytes[cursor..cursor + length]).unwrap();
        cursor += length;
        if payload.get("kind").and_then(|kind| kind.as_str()) == Some("queue_dropped") {
            dropped.push(
                payload["command_ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| id.as_str().unwrap().to_owned())
                    .collect(),
            );
        }
    }
    dropped
}

#[test]
fn session_close_strands_queued_commands_and_unknowns_the_in_flight_one() {
    let temp = Temp::new();
    let adapter = ExecutionAdapterState::new_with_gate(ExecutionSafetyState::open(&temp.0), true);
    adapter.session_started(true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-a").unwrap();
    enqueue(&adapter, "cmd-b").unwrap();
    enqueue(&adapter, "cmd-c").unwrap();
    let claimed = adapter.next_wire_message().expect("all gates are open");
    assert_eq!(claimed.command_id, "cmd-a");

    adapter.session_closed();
    let view = adapter.queue_status();
    assert_eq!(view.in_flight, None, "the sent command is never re-queued");
    assert_eq!(
        view.pending, 0,
        "queued commands do not survive the session"
    );
    assert_eq!(view.stranded, 2, "the two unsent commands are surfaced");

    // The next session inherits nothing dispatchable.
    adapter.session_started(true, "001234", "Broker-Demo");
    assert!(
        adapter.next_wire_message().is_none(),
        "nothing is auto-dispatched into a new session"
    );
    assert_eq!(
        adapter.queue_status().stranded,
        2,
        "the drop count stays visible for the UI"
    );
    drop(adapter);

    // Journal evidence: cmd-a resolved to `unknown`, QueueDropped names
    // exactly the two unsent ids, and replay accepts the new event kind.
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    let (_, entries) = journal.recovery_snapshot().unwrap();
    let in_flight = entries
        .iter()
        .find(|entry| entry.command_id == "cmd-a")
        .unwrap();
    assert_eq!(in_flight.state, "unknown");
    assert_eq!(
        queue_dropped_ids(&temp.0),
        vec![vec!["cmd-b".to_owned(), "cmd-c".to_owned()]],
        "QueueDropped carries the 2 unsent ids"
    );
}

#[test]
fn claim_gate_requires_trading_enabled_and_complete_reconciliation() {
    let temp = Temp::new();
    let adapter = ExecutionAdapterState::new_with_gate(ExecutionSafetyState::open(&temp.0), true);
    // trading_enabled=false from the handshake blocks the claim even with
    // the dispatch gate open in the test and reconciliation complete.
    adapter.session_started(false, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-a").unwrap();
    assert!(
        adapter.next_wire_message().is_none(),
        "trading_enabled=false must block the claim"
    );

    // A new session re-arms the handshake gate; reconciliation must reach
    // Complete before the queue moves.
    adapter.session_started(true, "001234", "Broker-Demo");
    enqueue(&adapter, "cmd-b").unwrap();
    assert!(
        adapter.next_wire_message().is_none(),
        "reconciliation not Complete must block the claim"
    );
    adapter.set_reconciliation_complete(true);
    assert_eq!(
        adapter
            .next_wire_message()
            .map(|command| command.command_id),
        Some("cmd-b".to_owned()),
        "all gates open -> the queue moves"
    );

    // The owner gate itself stays effective: a closed-gate instance
    // refuses claims no matter what the session flags say.
    let closed = ExecutionAdapterState::new_with_gate(ExecutionSafetyState::unavailable(), false);
    closed.session_started(true, "001234", "Broker-Demo");
    closed.set_reconciliation_complete(true);
    closed
        .enqueue(
            "cmd-c".to_owned(),
            MessageType::OrderSubmitRequest,
            serde_json::json!({}),
            None,
            10,
        )
        .unwrap();
    assert!(
        closed.next_wire_message().is_none(),
        "DISPATCH_ENABLED gate must stay decisive"
    );
}

#[test]
fn journal_failure_releases_tracking_but_blocks_future_claims() {
    let (_temp, adapter) = adapter();
    adapter.session_started(true, "001234", "Broker-Demo");
    adapter.set_reconciliation_complete(true);
    for id in ["cmd-a", "cmd-b", "cmd-c"] {
        enqueue(&adapter, id).unwrap();
    }
    assert_eq!(
        adapter
            .next_wire_message()
            .map(|command| command.command_id),
        Some("cmd-a".to_owned())
    );

    // A storage failure frees stale in-flight tracking, while preventing
    // any later queued command from being claimed.
    adapter.safety.mark_unavailable_for_test();
    assert!(matches!(
        adapter.apply_command_update(update("cmd-a", 1, 11, "server_accepted")),
        Err(ExecutionAdapterError::Journal(_))
    ));
    assert_eq!(
        adapter.queue_status().in_flight,
        None,
        "storage failure releases the in-flight tracking slot"
    );
    assert!(adapter.next_wire_message().is_none());
    assert_eq!(adapter.queue_status().pending, 2);
    assert_eq!(adapter.safety.status().journal_state, "error");
}

#[test]
fn boot_nonce_makes_command_ids_disjoint_across_states() {
    let first = ExecutionAdapterState::new_with_nonce(
        ExecutionSafetyState::unavailable(),
        true,
        0xaaaa_1111,
    );
    let second = ExecutionAdapterState::new_with_nonce(
        ExecutionSafetyState::unavailable(),
        true,
        0xbbbb_2222,
    );
    let clock = 1_770_000_000_000i64;
    let first_ids: std::collections::HashSet<String> =
        (0..8).map(|_| first.next_command_id(clock)).collect();
    let second_ids: std::collections::HashSet<String> =
        (0..8).map(|_| second.next_command_id(clock)).collect();
    assert_eq!(first_ids.len(), 8, "ids are unique inside one state");
    assert_eq!(second_ids.len(), 8, "ids are unique inside one state");
    assert!(
        first_ids.is_disjoint(&second_ids),
        "identical clocks and sequences must not collide across nonces"
    );
    assert!(
        first_ids.iter().all(|id| id.len() <= 128),
        "ids stay within the 128-byte protocol limit"
    );
    assert!(
        first_ids.contains(&format!("cmd-aaaa1111-{clock}-1")),
        "format: cmd-<nonce8-hex>-<unix-ms>-<seq>"
    );
    assert!(second_ids.contains(&format!("cmd-bbbb2222-{clock}-1")));
}

#[test]
fn account_binding_mismatch_rejects_updates_and_errors_without_state_change() {
    let temp = Temp::new();
    let adapter = ExecutionAdapterState::new_with_gate(ExecutionSafetyState::open(&temp.0), true);
    // The session runs under a different account than the intents bound
    // at enqueue time (001234 / Broker-Demo).
    adapter.session_started(true, "999999", "Other-Broker");
    adapter.set_reconciliation_complete(true);
    enqueue(&adapter, "cmd-x").unwrap();
    enqueue(&adapter, "cmd-y").unwrap();
    assert_eq!(
        adapter
            .next_wire_message()
            .map(|command| command.command_id),
        Some("cmd-x".to_owned())
    );

    assert!(matches!(
        adapter.apply_command_update(update("cmd-x", 1, 11, "server_accepted")),
        Err(ExecutionAdapterError::AccountMismatch)
    ));
    assert!(matches!(
        adapter.apply_command_error(OrderCommandError {
            command_id: "cmd-x".into(),
            code: "BROKER_UNAVAILABLE".into(),
            message: "broker connection unavailable".into(),
        }),
        Err(ExecutionAdapterError::AccountMismatch)
    ));
    let view = adapter.queue_status();
    assert_eq!(
        view.in_flight.as_deref(),
        Some("cmd-x"),
        "a rejected update must not release the slot"
    );
    assert_eq!(
        view.pending, 1,
        "a rejected error must not drop the queued command"
    );
    drop(adapter);

    // The journal recorded nothing: the command is still at `prepared`.
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    let (_, entries) = journal.recovery_snapshot().unwrap();
    let entry = entries
        .iter()
        .find(|entry| entry.command_id == "cmd-x")
        .unwrap();
    assert_eq!(entry.state, "prepared");
}
