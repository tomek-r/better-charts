use super::*;
use crate::execution_adapter::DISPATCH_ENABLED;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use trading_core::execution::{
    ExecutionOperation, ExecutionState, OrderKind, OrderSide, PlaceOrder,
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "execution-journal-{}-{unique}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        let p = dir.join("journal.bin");
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.parent().unwrap());
    }
}

fn intent(id: &str) -> ExecutionIntent {
    intent_with_volume(id, "0.10")
}

fn intent_with_volume(id: &str, volume: &str) -> ExecutionIntent {
    ExecutionIntent::new(
        id,
        "001234",
        "Broker-Demo",
        ExecutionOperation::PlaceOrder(PlaceOrder {
            symbol: "EURUSD".into(),
            side: OrderSide::Buy,
            kind: OrderKind::Limit,
            volume: volume.into(),
            entry: "1.1000".into(),
            stop_loss: Some("1.0900".into()),
            take_profit: Some("1.1200".into()),
            time_in_force: None,
            limit_price: None,
        }),
    )
    .unwrap()
}

#[test]
fn replays_after_restart_and_duplicate_register_does_not_grow_file() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register(intent("one"), 1).unwrap();
    let before = fs::metadata(&temp.0).unwrap().len();
    journal.register(intent("one"), 99).unwrap();
    assert_eq!(fs::metadata(&temp.0).unwrap().len(), before);
    journal
        .transition("one", ExecutionEvent::new(2, ExecutionState::Validated))
        .unwrap();
    drop(journal);
    let replayed = ExecutionJournal::open(&temp.0).unwrap();
    assert_eq!(replayed.command_count().unwrap(), 1);
}

#[test]
fn journal_allows_only_one_live_writer_and_releases_lock_on_drop() {
    let temp = Temp::new();
    let writer = ExecutionJournal::open(&temp.0).unwrap();
    writer.register(intent("one"), 1).unwrap();
    let bytes_before = fs::read(&temp.0).unwrap();

    assert!(matches!(
        ExecutionJournal::open(&temp.0),
        Err(JournalError::AlreadyOpen)
    ));
    assert_eq!(fs::read(&temp.0).unwrap(), bytes_before);

    drop(writer);
    let shared_writer = ExecutionJournal::open(&temp.0).unwrap();
    let retained_clone = shared_writer.clone();
    drop(shared_writer);
    assert!(matches!(
        ExecutionJournal::open(&temp.0),
        Err(JournalError::AlreadyOpen)
    ));
    drop(retained_clone);
    let next_writer = ExecutionJournal::open(&temp.0).unwrap();
    next_writer.register(intent("two"), 2).unwrap();
    assert_eq!(next_writer.command_count().unwrap(), 2);
}

#[test]
fn journal_lock_excludes_a_writer_in_another_process() {
    const CHILD_PATH: &str = "BETTER_CHARTS_JOURNAL_LOCK_CHILD_PATH";
    if let Some(path) = env::var_os(CHILD_PATH) {
        assert!(matches!(
            ExecutionJournal::open(path),
            Err(JournalError::AlreadyOpen)
        ));
        return;
    }

    let temp = Temp::new();
    let writer = ExecutionJournal::open(&temp.0).unwrap();
    let child = std::process::Command::new(env::current_exe().unwrap())
        .arg("--exact")
        .arg("execution_journal::tests::journal_lock_excludes_a_writer_in_another_process")
        .arg("--nocapture")
        .env(CHILD_PATH, &temp.0)
        .status()
        .unwrap();
    assert!(child.success(), "the second process must not open a writer");
    drop(writer);
}

#[test]
fn validated_registration_retries_prepared_and_is_idempotent() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    // Simulate a process crash after the first durable append.
    journal.register(intent("one"), 1).unwrap();
    drop(journal);

    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register_validated(intent("one"), 2).unwrap();
    let validated_size = fs::metadata(&temp.0).unwrap().len();
    journal.register_validated(intent("one"), 3).unwrap();
    assert_eq!(fs::metadata(&temp.0).unwrap().len(), validated_size);
    assert_eq!(journal.command_count().unwrap(), 1);
    assert_eq!(
        journal
            .inner
            .lock()
            .unwrap()
            .registry
            .get("one")
            .unwrap()
            .state(),
        ExecutionState::Validated
    );
}

#[test]
fn recovery_snapshot_replays_prepared_and_validated_without_promoting_them() {
    let temp = Temp::new();
    {
        let journal = ExecutionJournal::open(&temp.0).unwrap();
        journal.register(intent("prepared"), 10).unwrap();
        journal.register_validated(intent("validated"), 20).unwrap();
    }

    let journal = ExecutionJournal::open(&temp.0).unwrap();
    let (count, entries) = journal.recovery_snapshot().unwrap();
    assert_eq!(count, 2);
    assert_eq!(entries[0].command_id, "prepared");
    assert_eq!(entries[0].state, "prepared");
    assert_eq!(entries[0].recovery_status, "recovery_required");
    assert_eq!(entries[1].command_id, "validated");
    assert_eq!(entries[1].state, "validated");
    assert_eq!(entries[1].recovery_status, "validated_local");
    let inner = journal.inner.lock().unwrap();
    assert_eq!(
        inner.registry.get("prepared").unwrap().state(),
        ExecutionState::Prepared
    );
    assert_eq!(
        inner.registry.get("validated").unwrap().state(),
        ExecutionState::Validated
    );
}

#[test]
fn recovery_snapshot_is_camel_case_and_fails_closed_when_unavailable() {
    let temp = Temp::new();
    let journal_state = ExecutionSafetyState::open(&temp.0);
    journal_state
        .register_validated(intent("order-1"), 100)
        .unwrap();
    let (safety, entries) = journal_state.recovery_snapshot().unwrap();
    let value = serde_json::to_value(serde_json::json!({
        "safety": safety,
        "entries": entries,
    }))
    .unwrap();
    assert_eq!(value["safety"]["journalState"], "ready");
    assert_eq!(value["entries"][0]["commandId"], "order-1");
    assert_eq!(value["entries"][0]["operation"]["kind"], "place_order");
    assert_eq!(value["entries"][0]["operation"]["orderKind"], "limit");
    assert_eq!(value["entries"][0]["operation"]["takeProfit"], "1.1200");
    assert!(value["entries"][0].get("command_id").is_none());

    assert!(ExecutionSafetyState::unavailable()
        .recovery_snapshot()
        .is_err());
}

#[test]
fn validated_registration_rejects_conflict_and_later_state() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register_validated(intent("one"), 1).unwrap();
    let changed = intent_with_volume("one", "0.20");
    assert!(matches!(
        journal.register_validated(changed, 2),
        Err(JournalError::Execution(_))
    ));
    journal
        .transition("one", ExecutionEvent::new(2, ExecutionState::Dispatching))
        .unwrap();
    assert!(matches!(
        journal.register_validated(intent("one"), 3),
        Err(JournalError::Execution(_))
    ));
}

#[test]
fn conflict_and_legal_transition_are_checked_during_append_and_replay() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register(intent("one"), 1).unwrap();
    let changed = intent_with_volume("one", "0.20");
    assert!(matches!(
        journal.register(changed, 2),
        Err(JournalError::Execution(_))
    ));
    for state in [
        ExecutionState::Validated,
        ExecutionState::Dispatching,
        ExecutionState::Filled,
    ] {
        journal
            .transition("one", ExecutionEvent::new(2, state))
            .unwrap();
    }
    drop(journal);
    assert_eq!(
        ExecutionJournal::open(&temp.0)
            .unwrap()
            .command_count()
            .unwrap(),
        1
    );
}

#[test]
fn truncated_corrupt_oversize_and_invalid_sequence_fail_closed() {
    for bytes in [
        vec![0, 0],
        vec![0, 0, 0, 1, b'{'],
        vec![0, 1, 0, 1],
        vec![0, 1, 0, 1, b'x'],
    ] {
        let temp = Temp::new();
        fs::write(&temp.0, bytes).unwrap();
        assert!(ExecutionJournal::open(&temp.0).is_err());
    }
    let temp = Temp::new();
    fs::write(&temp.0, vec![0u8; MAX_FILE_BYTES as usize + 1]).unwrap();
    assert!(matches!(
        ExecutionJournal::open(&temp.0),
        Err(JournalError::FileTooLarge(_))
    ));
    let temp = Temp::new();
    fs::write(&temp.0, ((MAX_RECORD_BYTES as u32) + 1).to_be_bytes()).unwrap();
    assert!(matches!(
        ExecutionJournal::open(&temp.0),
        Err(JournalError::InvalidRecordLength(_))
    ));
    let temp = Temp::new();
    let payload = serde_json::to_vec(&JournalEntry::Transition {
        command_id: "missing".into(),
        event: ExecutionEvent::new(1, ExecutionState::Validated),
    })
    .unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend(payload);
    fs::write(&temp.0, bytes).unwrap();
    assert!(ExecutionJournal::open(&temp.0).is_err());
}

#[test]
fn command_update_and_error_events_replay_across_restart() {
    fn update(at_update: u64, updated_at_ms: i64, status: &str) -> OrderCommandUpdate {
        OrderCommandUpdate {
            command_id: "cmd-one".into(),
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
    let temp = Temp::new();
    {
        let journal = ExecutionJournal::open(&temp.0).unwrap();
        journal.register_validated(intent("cmd-one"), 10).unwrap();
        assert!(journal
            .apply_command_update(update(1, 11, "dispatching"))
            .unwrap());
        assert!(journal
            .apply_command_update(update(2, 12, "server_accepted"))
            .unwrap());
        // A stale counter is ignored without writing a single byte.
        let before = fs::metadata(&temp.0).unwrap().len();
        assert!(!journal
            .apply_command_update(update(2, 13, "server_accepted"))
            .unwrap());
        assert_eq!(fs::metadata(&temp.0).unwrap().len(), before);
        journal
            .apply_command_error(OrderCommandError {
                command_id: "cmd-one".into(),
                code: "JOURNAL_UNAVAILABLE".into(),
                message: "unable to write command journal".into(),
            })
            .unwrap();
    }

    // Simulated restart: the registry state and the at_update watermark
    // must both come back from replay so idempotency holds.
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    let (count, entries) = journal.recovery_snapshot().unwrap();
    assert_eq!(count, 1);
    assert_eq!(entries[0].state, "server_accepted");
    assert!(
        !journal
            .apply_command_update(update(2, 14, "filled"))
            .unwrap(),
        "stale at_update must stay stale across restart"
    );
    assert!(journal
        .apply_command_update(update(3, 15, "filled"))
        .unwrap());
    let (_, entries) = journal.recovery_snapshot().unwrap();
    assert_eq!(entries[0].state, "filled");
    // Invalid transitions fail closed without writing and without
    // poisoning the journal.
    let before = fs::metadata(&temp.0).unwrap().len();
    assert!(matches!(
        journal.apply_command_update(update(4, 16, "dispatching")),
        Err(JournalError::Execution(_))
    ));
    assert_eq!(fs::metadata(&temp.0).unwrap().len(), before);
    // Command errors are recorded even when the command is unknown here.
    assert!(journal
        .apply_command_error(OrderCommandError {
            command_id: "cmd-unknown".into(),
            code: "UNKNOWN_COMMAND".into(),
            message: "unknown command".into(),
        })
        .is_ok());
    drop(journal);
    assert_eq!(
        ExecutionJournal::open(&temp.0)
            .unwrap()
            .command_count()
            .unwrap(),
        1
    );
}

#[test]
fn queue_dropped_events_are_durable_audit_facts_and_replay_cleanly() {
    let temp = Temp::new();
    {
        let journal = ExecutionJournal::open(&temp.0).unwrap();
        journal.register(intent("one"), 1).unwrap();
        let before = fs::metadata(&temp.0).unwrap().len();
        journal
            .record_queue_dropped(vec!["one".into(), "two".into()], "session closed".into())
            .unwrap();
        assert!(
            fs::metadata(&temp.0).unwrap().len() > before,
            "the drop is durably appended"
        );
        assert_eq!(
            journal.command_count().unwrap(),
            1,
            "queue drops never change registry state"
        );
        // An empty drop is a no-op: nothing to audit, nothing to write.
        let empty = fs::metadata(&temp.0).unwrap().len();
        journal
            .record_queue_dropped(Vec::new(), "session closed".into())
            .unwrap();
        assert_eq!(fs::metadata(&temp.0).unwrap().len(), empty);
        // The F-5 account binding reads back through the same journal.
        assert_eq!(
            journal.command_account("one"),
            Some(("001234".into(), "Broker-Demo".into()))
        );
        assert_eq!(journal.command_account("missing"), None);
    }
    // Replay: the QueueDropped record is consumed without registry
    // effects, so journals from before the variant still open too.
    let replayed = ExecutionJournal::open(&temp.0).unwrap();
    assert_eq!(replayed.command_count().unwrap(), 1);
}

#[test]
fn poisoned_journal_reports_generic_error_and_mirrors_the_dispatch_gate() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    let poisoned = journal.clone();
    let _ = std::thread::spawn(move || {
        let _guard = poisoned.inner.lock().unwrap();
        panic!("poison journal mutex for status test");
    })
    .join();
    let status = ExecutionSafetyState {
        journal: Some(journal),
    }
    .status();
    assert_eq!(status.journal_state, "error");
    assert_eq!(status.command_count, 0);
    assert_eq!(status.dispatch_enabled, DISPATCH_ENABLED);
    assert_eq!(
        status.message,
        "Execution journal unavailable; dispatch is enabled (owner-approved)."
    );
}

#[test]
fn exhausted_journal_fails_closed_even_for_idempotent_duplicate() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register(intent("one"), 1).unwrap();
    {
        let mut inner = journal.inner.lock().unwrap();
        inner.failed = true;
    }
    assert!(matches!(
        journal.register(intent("one"), 2),
        Err(JournalError::Unavailable)
    ));
    let status = ExecutionSafetyState {
        journal: Some(journal),
    }
    .status();
    assert_eq!(status.journal_state, "error");
    assert_eq!(status.dispatch_enabled, DISPATCH_ENABLED);
}

#[test]
fn capacity_exhaustion_marks_journal_unavailable() {
    let temp = Temp::new();
    let journal = ExecutionJournal::open(&temp.0).unwrap();
    journal.register(intent("one"), 1).unwrap();
    {
        let mut inner = journal.inner.lock().unwrap();
        inner.entries = MAX_ENTRIES;
    }
    assert!(matches!(
        journal.register(intent("two"), 2),
        Err(JournalError::TooManyEntries)
    ));
    let status = ExecutionSafetyState {
        journal: Some(journal),
    }
    .status();
    assert_eq!(status.journal_state, "error");
    assert_eq!(status.dispatch_enabled, DISPATCH_ENABLED);
}

#[test]
fn safety_status_uses_camel_case_and_never_exposes_storage_path() {
    let temp = Temp::new();
    let status = ExecutionSafetyState::open(&temp.0).status();
    let value = serde_json::to_value(status).unwrap();
    assert_eq!(value["journalState"], "ready");
    assert_eq!(value["commandCount"], 0);
    assert_eq!(value["dispatchEnabled"], DISPATCH_ENABLED);
    assert_eq!(
        value["message"],
        "Durable journal ready; dispatch is enabled (owner-approved)."
    );
    assert!(serde_json::to_string(&value)
        .unwrap()
        .find(temp.0.to_str().unwrap())
        .is_none());
}
