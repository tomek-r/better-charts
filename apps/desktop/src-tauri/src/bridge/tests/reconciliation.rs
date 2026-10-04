//! Reconciliation snapshot acceptance tests (session/account/range binding, camel-case status wire shape).
use super::*;

fn reconciliation_request_for_test() -> ReconcileRequest {
    ReconcileRequest {
        request_id: "reconcile-1".into(),
        account_login: "10001".into(),
        broker_server: "Broker-Demo".into(),
        history_from_ms: 100,
        max_history_orders: 500,
        max_history_deals: 500,
    }
}

fn reconciliation_snapshot_for_test() -> ReconcileSnapshot {
    ReconcileSnapshot {
        request_id: "reconcile-1".into(),
        account_login: "10001".into(),
        broker_server: "Broker-Demo".into(),
        snapshot_id: "snapshot-1".into(),
        history_from_ms: 100,
        history_to_ms: 200,
        sequence_before: 8,
        sequence_after: 8,
        complete: true,
        captured_at_ms: 200,
        positions: vec![],
        active_orders: vec![],
        history_orders: vec![],
        history_deals: vec![],
    }
}

fn expected_reconciliation_for_test() -> Option<ExpectedReconciliation> {
    Some(ExpectedReconciliation {
        session_id: "session-1".into(),
        request: reconciliation_request_for_test(),
    })
}

#[test]
fn reconciliation_accepts_current_complete_snapshot_and_camel_case_status() {
    let mut expected = expected_reconciliation_for_test();
    let status = accept_reconciliation_snapshot(
        &mut expected,
        "session-1",
        "ea-reconcile-1",
        reconciliation_snapshot_for_test(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(status.state, ReconciliationStateKind::Complete);
    assert_eq!(status.request_id.as_deref(), Some("reconcile-1"));
    assert!(expected.is_none());
    let json = serde_json::to_value(status).unwrap();
    assert_eq!(json["requestId"], "reconcile-1");
    assert_eq!(json["snapshotId"], "snapshot-1");
    assert_eq!(json["historyFromMs"], 100);
    assert_eq!(json["sequenceBefore"], 8);
    assert_eq!(json["positionCount"], 0);
    assert_eq!(json["activeOrderCount"], 0);
    assert_eq!(json["historyOrderCount"], 0);
    assert_eq!(json["historyDealCount"], 0);
}

#[test]
fn reconciliation_ignores_stale_or_other_session_and_rejects_account_range_mismatch() {
    let mut expected = expected_reconciliation_for_test();
    assert!(accept_reconciliation_snapshot(
        &mut expected,
        "session-old",
        "reconcile-1",
        reconciliation_snapshot_for_test(),
    )
    .unwrap()
    .is_none());
    assert!(accept_reconciliation_snapshot(
        &mut expected,
        "session-1",
        "ea-reconcile-old",
        ReconcileSnapshot {
            request_id: "older-request".into(),
            ..reconciliation_snapshot_for_test()
        },
    )
    .unwrap()
    .is_none());
    let mut mismatched_account = reconciliation_snapshot_for_test();
    mismatched_account.account_login = "different-account".into();
    assert!(accept_reconciliation_snapshot(
        &mut expected,
        "session-1",
        "ea-reconcile-1",
        mismatched_account,
    )
    .is_err());
    let mut mismatched_range = reconciliation_snapshot_for_test();
    mismatched_range.history_from_ms += 1;
    assert!(accept_reconciliation_snapshot(
        &mut expected,
        "session-1",
        "ea-reconcile-1",
        mismatched_range,
    )
    .is_err());
    assert!(expected.is_some());
}

#[test]
fn reconciliation_incomplete_sequence_is_explicit_and_errors_are_bound_to_request() {
    let mut expected = expected_reconciliation_for_test();
    let mut incomplete = reconciliation_snapshot_for_test();
    incomplete.complete = false;
    incomplete.sequence_after += 1;
    let status =
        accept_reconciliation_snapshot(&mut expected, "session-1", "ea-reconcile-1", incomplete)
            .unwrap()
            .unwrap();
    assert_eq!(status.state, ReconciliationStateKind::Incomplete);
    assert_eq!(status.sequence_before, Some(8));
    assert_eq!(status.sequence_after, Some(9));

    let mut expected = expected_reconciliation_for_test();
    assert!(accept_reconciliation_error(
        &mut expected,
        "session-1",
        "ea-reconcile-old",
        ReconcileError {
            request_id: "older-request".into(),
            code: "history_unavailable".into(),
            message: "history unavailable".into(),
        },
    )
    .unwrap()
    .is_none());
    let status = accept_reconciliation_error(
        &mut expected,
        "session-1",
        "ea-reconcile-1",
        ReconcileError {
            request_id: "reconcile-1".into(),
            code: "history_unavailable".into(),
            message: "history unavailable".into(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(status.state, ReconciliationStateKind::Error);
    assert_eq!(
        status.message.as_deref(),
        Some("history_unavailable: history unavailable")
    );
}
