//! Partial-close gate: the capability check and the symbol volume rules run
//! before anything is queued or journalled.
use super::common::*;
use super::dispatch::temp_adapter_state;
use super::*;
use trading_core::protocol::{OpenPosition, PortfolioSnapshot};

const UNSUPPORTED: &str = "partial close is not supported by the connected EA; update the EA";

fn position(volume_min: Option<&str>, volume_step: Option<&str>) -> OpenPosition {
    OpenPosition {
        position_id: "9001".into(),
        ticket: "9001".into(),
        symbol: "NAS".into(),
        side: OrderSide::Buy,
        volume: "1.00".into(),
        price_open: "100".into(),
        price_current: "101".into(),
        stop_loss: None,
        take_profit: None,
        stop_loss_profit: None,
        take_profit_profit: None,
        profit: "1".into(),
        swap: "0".into(),
        time_ms: 1,
        magic: "0".into(),
        volume_min: volume_min.map(str::to_owned),
        volume_step: volume_step.map(str::to_owned),
    }
}

fn bridge_with_position(partial_close: bool, position: Option<OpenPosition>) -> BridgeState {
    let bridge = ready_state_with_result(order_check_result_for_test());
    bridge.status.lock().unwrap().partial_close = partial_close;
    let snapshot = PortfolioSnapshot {
        account_login: "123".into(),
        captured_at_ms: 1,
        positions: position.into_iter().collect(),
        orders: vec![],
    };
    *bridge.portfolio.lock().unwrap() = Some(PortfolioView::from(snapshot));
    bridge
}

fn close(
    bridge: &BridgeState,
    adapter: &ExecutionAdapterState,
    volume: Option<&str>,
) -> Result<(), String> {
    queue_close_position(
        bridge,
        adapter,
        "123".into(),
        "Demo".into(),
        "9001".into(),
        volume.map(str::to_owned),
    )
}

fn assert_rejected_without_side_effects(bridge: &BridgeState, volume: &str, expected_error: &str) {
    let (path, adapter) = temp_adapter_state();
    assert_eq!(
        close(bridge, &adapter, Some(volume)).unwrap_err(),
        expected_error
    );
    assert_eq!(adapter.queue_status().pending, 0);
    drop(adapter);
    let journal = crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    assert_eq!(journal.command_count().unwrap(), 0);
    let _ = std::fs::remove_file(path);
}

#[test]
fn partial_volume_is_rejected_without_the_negotiated_capability() {
    let bridge = bridge_with_position(false, Some(position(Some("0.01"), Some("0.01"))));
    assert_rejected_without_side_effects(&bridge, "0.30", UNSUPPORTED);
}

#[test]
fn partial_volume_is_rejected_when_limits_are_unknown() {
    for unknown in [
        bridge_with_position(true, None),
        bridge_with_position(true, Some(position(None, None))),
        bridge_with_position(true, Some(position(Some("0.01"), None))),
    ] {
        assert_rejected_without_side_effects(
            &unknown,
            "0.30",
            "position volume limits are unavailable",
        );
    }
    let no_snapshot = bridge_with_position(true, None);
    *no_snapshot.portfolio.lock().unwrap() = None;
    assert_rejected_without_side_effects(
        &no_snapshot,
        "0.30",
        "position volume limits are unavailable",
    );
}

#[test]
fn invalid_partial_volume_is_rejected_without_side_effects() {
    let bridge = bridge_with_position(true, Some(position(Some("0.01"), Some("0.10"))));
    assert_rejected_without_side_effects(
        &bridge,
        "0.25",
        "close volume is not a multiple of the symbol volume step",
    );
    assert_rejected_without_side_effects(
        &bridge,
        "1.10",
        "close volume exceeds the position volume",
    );
}

#[test]
fn valid_partial_volume_is_queued_with_its_volume_and_journalled() {
    let bridge = bridge_with_position(true, Some(position(Some("0.01"), Some("0.01"))));
    let (path, adapter) = temp_adapter_state();
    close(&bridge, &adapter, Some("0.30")).unwrap();
    assert_eq!(adapter.queue_status().pending, 1);
    drop(adapter);
    let journal = crate::execution_journal::ExecutionJournal::open(&path).unwrap();
    assert_eq!(journal.command_count().unwrap(), 1);
    let _ = std::fs::remove_file(path);
}

#[test]
fn full_close_does_not_depend_on_the_capability_or_limits() {
    let bridge = bridge_with_position(false, None);
    let (path, adapter) = temp_adapter_state();
    close(&bridge, &adapter, None).unwrap();
    assert_eq!(adapter.queue_status().pending, 1);
    let _ = std::fs::remove_file(path);
}

#[test]
fn portfolio_view_exposes_volume_limits_in_camel_case() {
    let snapshot = PortfolioSnapshot {
        account_login: "123".into(),
        captured_at_ms: 1,
        positions: vec![position(Some("0.01"), Some("0.10"))],
        orders: vec![],
    };
    let json = serde_json::to_value(PortfolioView::from(snapshot)).unwrap();
    assert_eq!(json["positions"][0]["volumeMin"], "0.01");
    assert_eq!(json["positions"][0]["volumeStep"], "0.10");
}
