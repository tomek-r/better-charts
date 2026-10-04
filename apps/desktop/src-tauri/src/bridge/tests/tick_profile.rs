//! Tick-history to fixed-range volume profile conversion tests.
use super::common::*;
use super::*;

#[test]
fn tick_snapshot_builds_frontend_profile_shape() {
    let wire = TickHistoryRequest {
        symbol: "NAS100".into(),
        from_ms: 100,
        to_ms: 200,
        max_ticks: 5000,
    };
    let request = TickProfileRequest {
        wire: wire.clone(),
        rows: 128,
    };
    let tick = |time_ms, bid: &str, ask: &str, flags| trading_core::protocol::MarketTick {
        time_ms,
        bid: bid.into(),
        ask: ask.into(),
        last: "0".into(),
        volume: 0,
        volume_real: "0".into(),
        flags,
    };
    let state = BridgeState::with_symbol_cache_path(None);
    let result = build_tick_profile(
        &state,
        TickHistorySnapshot {
            request_id: "rust-ticks-1".into(),
            symbol: wire.symbol.clone(),
            from_ms: wire.from_ms,
            to_ms: wire.to_ms,
            tick_size: "0.1".into(),
            complete: true,
            ticks: vec![
                tick(110, "100.0", "100.2", 2),
                tick(120, "100.1", "100.3", 6),
            ],
        },
        &request,
    )
    .unwrap();
    assert_eq!(result.total_weight, 2);
    assert_eq!(result.actual_rows, result.bins.len());
    assert_eq!(result.bins.iter().map(|bin| bin.bid).sum::<u64>(), 2);
    assert_eq!(result.bins.iter().map(|bin| bin.ask).sum::<u64>(), 1);
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value["fromMs"], 100);
    assert_eq!(value["endMs"], 200);
    assert_eq!(value["totalWeight"], 2);
    assert!(value.get("from_ms").is_none());
    assert!(value["bins"][0].get("ask").is_some(), "bins expose ask");
    assert_eq!(value["bins"][0]["bid"], 1);
    assert_eq!(value["poc"], "100.05");
    assert_eq!(value["bidLevels"]["poc"], "100.05");
    assert_eq!(value["bidLevels"]["vah"], "100.2");
    assert_eq!(value["bidLevels"]["val"], "100");
    assert_eq!(value["askLevels"]["poc"], "100.35");
    assert_eq!(value["askLevels"]["vah"], "100.4");
    assert_eq!(value["askLevels"]["val"], "100.3");
}

fn nas100_profile_request() -> TickProfileRequest {
    TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "NAS100".into(),
            from_ms: 100,
            to_ms: 200,
            max_ticks: 5000,
        },
        rows: 128,
    }
}

fn profile_tick(
    time_ms: i64,
    bid: &str,
    ask: &str,
    flags: u32,
) -> trading_core::protocol::MarketTick {
    trading_core::protocol::MarketTick {
        time_ms,
        bid: bid.into(),
        ask: ask.into(),
        last: "0".into(),
        volume: 0,
        volume_real: "0".into(),
        flags,
    }
}

fn profile_snapshot(ticks: Vec<trading_core::protocol::MarketTick>) -> TickHistorySnapshot {
    TickHistorySnapshot {
        request_id: "rust-ticks-1".into(),
        symbol: "NAS100".into(),
        from_ms: 100,
        to_ms: 200,
        tick_size: "0.1".into(),
        complete: true,
        ticks,
    }
}

#[test]
fn frontend_profile_bins_carry_total_bid_and_ask_weights() {
    let state = BridgeState::with_symbol_cache_path(None);
    let result = build_tick_profile(
        &state,
        profile_snapshot(vec![
            profile_tick(110, "100.0", "100.2", 6), // both sides: total+bid @100.0, ask @100.2
            profile_tick(120, "100.0", "100.2", 2), // bid only: total+bid @100.0
            profile_tick(130, "100.1", "100.3", 4), // ask only: total @100.1, ask @100.3
        ]),
        &nas100_profile_request(),
    )
    .unwrap();

    assert_eq!(
        result.total_weight, 3,
        "one total weight per flagged tick, at the bid price"
    );
    assert_eq!(result.rejected_ticks, 0);
    assert_eq!(result.bins.iter().map(|bin| bin.total).sum::<u64>(), 3);
    assert_eq!(result.bins.iter().map(|bin| bin.bid).sum::<u64>(), 2);
    assert_eq!(
        result.bins.iter().map(|bin| bin.ask).sum::<u64>(),
        2,
        "bid+ask may exceed total: the both-sides tick adds 2 vs total 1"
    );
    assert_eq!(result.bins[0].low, "100");
    assert_eq!(
        (result.bins[0].total, result.bins[0].bid, result.bins[0].ask),
        (2, 2, 0),
        "total and bid weights sit at the bid price"
    );
    assert_eq!(
        result.bins[1].total, 1,
        "ask-only tick's total weight at its bid"
    );
    assert_eq!(
        result.bins[2].total, 0,
        "ask weight lands at the ask price, away from the total weight"
    );
    assert_eq!(result.bins[2].ask, 1);
    assert_eq!(result.bins[3].ask, 1);

    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["bins"][2]["ask"], 1);
    assert_eq!(value["poc"], "100.05");
    assert_eq!(value["vah"], "100.2");
    assert_eq!(value["val"], "100");
    assert_eq!(value["bidLevels"]["poc"], "100.05");
    assert_eq!(value["bidLevels"]["vah"], "100.1");
    assert_eq!(value["bidLevels"]["val"], "100");
    assert_eq!(value["askLevels"]["poc"], "100.25");
    assert_eq!(value["askLevels"]["vah"], "100.4");
    assert_eq!(value["askLevels"]["val"], "100.2");
}

#[test]
fn tick_profile_grid_prefers_cached_symbol_tick_size() {
    let state = BridgeState::with_symbol_cache_path(None);
    let mut symbol = broker_symbol("NAS100");
    symbol.tick_size = "0.25".into();
    state.remember_symbols([symbol]);
    let result = build_tick_profile(
        &state,
        profile_snapshot(vec![
            // Adjacent bids are 0.05 apart; the cached 0.25 grid wins.
            profile_tick(110, "100.00", "100.01", 2),
            profile_tick(120, "100.05", "100.06", 2),
            profile_tick(130, "100.10", "100.11", 2),
        ]),
        &nas100_profile_request(),
    )
    .unwrap();

    assert_eq!(result.total_weight, 3);
    assert_eq!(
        result.actual_rows, 1,
        "a 0.10 span on the cached 0.25 grid fits one bin"
    );
    assert_eq!(result.bins.len(), 1);
    assert_eq!(result.bins[0].low, "100");
    assert_eq!(result.bins[0].high, "100.25");
    assert_eq!(result.bins[0].total, 3);
}

#[test]
fn tick_profile_grid_falls_back_to_tick_stream_when_symbol_unknown() {
    let state = BridgeState::with_symbol_cache_path(None);
    let result = build_tick_profile(
        &state,
        profile_snapshot(vec![
            profile_tick(110, "100.00", "100.01", 2),
            profile_tick(120, "100.05", "100.02", 2),
            profile_tick(130, "100.10", "100.11", 2),
        ]),
        &nas100_profile_request(),
    )
    .unwrap();

    // The smallest gap between distinct bids (0.05) defines the grid,
    // even though the snapshot itself carries tick_size "0.1".
    assert_eq!(result.total_weight, 3);
    assert_eq!(result.bins.len(), 3);
    assert_eq!(
        result
            .bins
            .iter()
            .map(|bin| bin.low.as_str())
            .collect::<Vec<_>>(),
        ["100", "100.05", "100.1"]
    );
    for bin in &result.bins {
        let low: rust_decimal::Decimal = bin.low.parse().unwrap();
        let high: rust_decimal::Decimal = bin.high.parse().unwrap();
        let width_ticks = (high - low) / rust_decimal::Decimal::new(5, 2);
        assert_eq!(
            width_ticks.fract(),
            rust_decimal::Decimal::ZERO,
            "bin width {high} - {low} must stay on the 0.05 grid"
        );
    }

    // Fewer than two distinct bids: the whole input's min/max price
    // span (both quote sides) becomes the grid instead.
    let one_bid = build_tick_profile(
        &state,
        profile_snapshot(vec![
            profile_tick(110, "100.0", "100.1", 4),
            profile_tick(120, "100.0", "100.3", 4),
        ]),
        &nas100_profile_request(),
    )
    .unwrap();
    assert_eq!(one_bid.total_weight, 2);
    assert_eq!(one_bid.bins.len(), 2, "0.3 span over 128 rows is two bins");
    assert_eq!(one_bid.bins[0].low, "99.9");
    assert_eq!(one_bid.bins[0].high, "100.2");
    assert_eq!(one_bid.bins[1].high, "100.5");
}

#[test]
fn fallback_grid_deduplicates_decimal_scales_without_changing_invalid_quote_semantics() {
    use rust_decimal::Decimal;
    let state = BridgeState::with_symbol_cache_path(None);
    let ticks = (0..100_000)
        .map(|index| trading_core::volume_profile::Tick {
            time_millis: index,
            bid: ["100.00", "100.000", "100.10", "100.15", "0"][index as usize % 5]
                .parse()
                .unwrap(),
            ask: Decimal::from(101),
            flags: 0,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        resolve_tick_size(&state, "UNKNOWN", &ticks),
        Decimal::new(5, 2)
    );
}

#[test]
fn empty_profile_modes_serialize_null_bid_and_ask_levels() {
    let state = BridgeState::with_symbol_cache_path(None);
    let request = nas100_profile_request();

    let bid_only = serde_json::to_value(
        build_tick_profile(
            &state,
            profile_snapshot(vec![
                profile_tick(110, "100.0", "100.2", 2),
                profile_tick(120, "100.1", "100.3", 2),
            ]),
            &request,
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(bid_only["bidLevels"]["poc"], "100.05");
    assert_eq!(
        bid_only.get("askLevels"),
        Some(&serde_json::Value::Null),
        "an empty ask mode must send the field as null, not omit it"
    );
    assert_eq!(bid_only["bins"][0]["ask"], 0);

    let empty = serde_json::to_value(
        build_tick_profile(&state, profile_snapshot(vec![]), &request).unwrap(),
    )
    .unwrap();
    assert_eq!(empty.get("bidLevels"), Some(&serde_json::Value::Null));
    assert_eq!(empty.get("askLevels"), Some(&serde_json::Value::Null));
    assert_eq!(empty.get("poc"), Some(&serde_json::Value::Null));
    assert_eq!(empty["totalWeight"], 0);
    assert_eq!(
        empty["complete"], true,
        "complete keeps reporting tick fetching, not computation"
    );
    assert!(empty["bins"].as_array().unwrap().is_empty());
}
