//! Tick page caching: generation control, gap re-requests, limits and coverage.
use super::*;

#[test]
fn tick_cache_controller_hits_cache_and_cancels_old_generation() {
    let request = tick_request(0, 10);
    let mut controller = TickCacheController::default();
    let first = controller.begin(request.clone());
    assert_eq!(
        first,
        vec![trading_core::volume_profile::TickRange {
            start_ms: 0,
            end_ms: 10
        }]
    );
    let generation = controller.generation;
    let complete = tick_snapshot(0, 10, true, vec![]);
    assert!(matches!(
        controller.ingest(generation, complete),
        TickPageResult::Final(_, _)
    ));
    assert_eq!(controller.cached_tick_count("NAS"), 0);
    assert!(controller.begin(request).is_empty());
    controller.cancel();
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 10, true, vec![])),
        TickPageResult::Stale
    ));
}

fn tick_request(from_ms: i64, to_ms: i64) -> TickProfileRequest {
    TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "NAS".into(),
            from_ms,
            to_ms,
            max_ticks: 5000,
        },
        rows: 32,
    }
}

fn market_tick(time_ms: i64) -> trading_core::protocol::MarketTick {
    trading_core::protocol::MarketTick {
        time_ms,
        bid: "100.0".into(),
        ask: "100.1".into(),
        last: "0".into(),
        volume: 0,
        volume_real: "0".into(),
        flags: 6,
    }
}

fn tick_snapshot(
    from_ms: i64,
    to_ms: i64,
    complete: bool,
    ticks: Vec<trading_core::protocol::MarketTick>,
) -> TickHistorySnapshot {
    TickHistorySnapshot {
        request_id: "page".into(),
        symbol: "NAS".into(),
        from_ms,
        to_ms,
        tick_size: "0.1".into(),
        complete,
        ticks,
    }
}

fn tick_range(start_ms: i64, end_ms: i64) -> trading_core::volume_profile::TickRange {
    trading_core::volume_profile::TickRange { start_ms, end_ms }
}

#[test]
fn incomplete_whole_page_is_retried_as_halves_and_aggregated_once_complete() {
    let mut controller = TickCacheController::default();
    let request = tick_request(0, 10);
    controller.begin(request.clone());
    let generation = controller.generation;

    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 10, false, vec![market_tick(1)])),
        TickPageResult::Next(page) if page.wire.from_ms == 0 && page.wire.to_ms == 5
    ));
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 5, true, vec![market_tick(1)])),
        TickPageResult::Next(page) if page.wire.from_ms == 5 && page.wire.to_ms == 10
    ));
    let TickPageResult::Final(snapshot, final_request) =
        controller.ingest(generation, tick_snapshot(5, 10, true, vec![market_tick(6)]))
    else {
        panic!("expected final aggregate");
    };
    assert!(snapshot.complete);
    assert_eq!(
        snapshot
            .ticks
            .iter()
            .map(|tick| tick.time_ms)
            .collect::<Vec<_>>(),
        [1, 6]
    );
    let state = BridgeState::with_symbol_cache_path(None);
    assert_eq!(
        build_tick_profile(&state, snapshot, &final_request)
            .unwrap()
            .total_weight,
        2
    );
}

#[test]
fn terminal_partial_waits_for_other_gaps_before_finalizing() {
    let mut controller = TickCacheController::default();
    controller.begin(tick_request(0, 2));
    let generation = controller.generation;
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 2, false, vec![])),
        TickPageResult::Next(_)
    ));
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 1, false, vec![market_tick(0)])),
        TickPageResult::Next(page) if page.wire.from_ms == 1 && page.wire.to_ms == 2
    ));
    let TickPageResult::Final(snapshot, _) =
        controller.ingest(generation, tick_snapshot(1, 2, true, vec![market_tick(1)]))
    else {
        panic!("terminal leaf must wait for all gaps");
    };
    assert!(!snapshot.complete);
    assert_eq!(snapshot.ticks.len(), 2);
}

#[test]
fn tick_progress_counts_split_pages_and_only_loaded_ticks() {
    let mut controller = TickCacheController::default();
    controller.begin(tick_request(0, 2));
    assert_eq!(
        controller.progress().unwrap().completed_pages,
        0,
        "starting progress has no wire pages"
    );
    assert_eq!(controller.progress().unwrap().pending_pages, 1);
    assert_eq!(controller.progress().unwrap().loaded_ticks, 0);

    assert!(matches!(
        controller.ingest(
            generation(&controller),
            tick_snapshot(0, 2, false, vec![market_tick(0)])
        ),
        TickPageResult::Next(_)
    ));
    let progress = controller.progress().unwrap();
    assert_eq!(progress.completed_pages, 1);
    assert_eq!(progress.pending_pages, 2);
    assert_eq!(progress.loaded_ticks, 0, "split page data is discarded");

    assert!(matches!(
        controller.ingest(
            generation(&controller),
            tick_snapshot(0, 1, true, vec![market_tick(0)])
        ),
        TickPageResult::Next(_)
    ));
    let progress = controller.progress().unwrap();
    assert_eq!(progress.completed_pages, 2);
    assert_eq!(progress.pending_pages, 1);
    assert_eq!(progress.loaded_ticks, 1);
    let json = serde_json::to_value(progress).unwrap();
    assert_eq!(json["completedPages"], 2);
    assert!(json.get("loaded_ticks").is_none());
}

#[test]
fn truncated_pages_retain_the_complete_prefix_and_replay_boundary_ticks_once() {
    let mut controller = TickCacheController::default();
    controller.begin(tick_request(0, 10));
    let generation = controller.generation;
    let first_page = tick_snapshot(
        0,
        10,
        false,
        vec![market_tick(1), market_tick(2), market_tick(2)],
    );
    assert!(matches!(
        controller.ingest(generation, first_page),
        TickPageResult::Next(page) if page.wire.from_ms == 2 && page.wire.to_ms == 10
    ));
    assert_eq!(controller.progress().unwrap().loaded_ticks, 1);
    assert_eq!(controller.progress().unwrap().pending_pages, 1);
    assert_eq!(controller.entries[0].range, tick_range(0, 2));
    assert!(controller.entries[0].snapshot.complete);

    let TickPageResult::Final(snapshot, request) = controller.ingest(
        generation,
        tick_snapshot(
            2,
            10,
            true,
            vec![
                market_tick(2),
                market_tick(2),
                market_tick(2),
                market_tick(8),
            ],
        ),
    ) else {
        panic!("the final page should complete the profile");
    };
    assert!(snapshot.complete);
    assert_eq!(
        snapshot
            .ticks
            .iter()
            .map(|tick| tick.time_ms)
            .collect::<Vec<_>>(),
        [1, 2, 2, 2, 8],
        "the boundary millisecond must be included exactly once and in full"
    );
    let state = BridgeState::with_symbol_cache_path(None);
    assert_eq!(
        build_tick_profile(&state, snapshot, &request)
            .unwrap()
            .total_weight,
        5
    );
}

#[test]
fn dense_history_loads_in_full_pages_without_refetching_time_halves() {
    for (tick_count, page_size, max_pages) in [
        (100_000, 5000, 22),
        (100_000, 65535, 2),
        (250_000, 65535, 4),
    ] {
        let ticks = (0..tick_count)
            .map(|index| {
                let mut tick = market_tick(index / 3);
                tick.bid = format!("100.{}", index % 10);
                tick
            })
            .collect::<Vec<_>>();
        let mut controller = TickCacheController::default();
        let mut request = tick_request(0, 100_000);
        request.wire.max_ticks = page_size;
        controller.begin(request);
        let mut pages = 0;
        let mut transferred_ticks = 0;
        loop {
            let (generation, page) = controller.next_page().unwrap();
            let start = ticks.partition_point(|tick| tick.time_ms < page.wire.from_ms);
            let end = ticks.partition_point(|tick| tick.time_ms < page.wire.to_ms);
            let count = usize::from(page.wire.max_ticks);
            let page_end = (start + count).min(end);
            let payload = ticks[start..page_end].to_vec();
            transferred_ticks += payload.len();
            pages += 1;
            match controller.ingest(
                generation,
                tick_snapshot(page.wire.from_ms, page.wire.to_ms, page_end == end, payload),
            ) {
                TickPageResult::Next(_) => {}
                TickPageResult::Final(snapshot, _) => {
                    assert!(snapshot.complete);
                    assert_eq!(snapshot.ticks, ticks);
                    break;
                }
                other => panic!("dense history should complete: {other:?}"),
            }
        }
        assert!(
            pages <= max_pages,
            "{tick_count} ticks took {pages} requests with page size {page_size}"
        );
        assert!(
            transferred_ticks <= ticks.len() + pages * 3,
            "only boundary-millisecond ticks should be transferred twice"
        );
    }
}

#[test]
fn explicit_cancel_clears_pending_state_and_makes_the_old_generation_stale() {
    let state = BridgeState::default();
    let request = tick_request(0, 1);
    let generation = {
        let mut controller = state.tick_controller.lock().unwrap();
        controller.begin(request.clone());
        controller.generation
    };
    *state.pending_tick_profile.lock().unwrap() = Some(request.clone());
    *state.expected_tick_profile.lock().unwrap() = Some((generation, "old".into(), request));
    let status = state.status.lock().unwrap().clone();

    let cancelled = cancel_active_tick_profile(&state).unwrap();

    assert!(state.pending_tick_profile.lock().unwrap().is_none());
    assert!(state.expected_tick_profile.lock().unwrap().is_none());
    assert_eq!(
        cancelled,
        TickProfileCancelledView {
            symbol: "NAS".into(),
            from_ms: 0,
            end_ms: 1,
        }
    );
    let json = serde_json::to_value(cancelled).unwrap();
    assert_eq!(json["fromMs"], 0);
    assert_eq!(json["endMs"], 1);
    assert!(json.get("from_ms").is_none());
    assert!(matches!(
        state
            .tick_controller
            .lock()
            .unwrap()
            .ingest(generation, tick_snapshot(0, 1, true, vec![])),
        TickPageResult::Stale
    ));
    assert_eq!(*state.status.lock().unwrap(), status);
    assert!(cancel_active_tick_profile(&state).is_none());
}

#[test]
fn active_page_limit_stops_without_falsely_completing_the_range() {
    let mut controller = TickCacheController::default();
    controller.begin(tick_request(0, 2));
    let generation = controller.generation;
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 2, false, vec![])),
        TickPageResult::Next(_)
    ));
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 1, true, vec![market_tick(0)])),
        TickPageResult::Next(_)
    ));
    controller.active.as_mut().unwrap().completed_pages = MAX_ACTIVE_TICK_PAGES;
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(1, 2, true, vec![market_tick(1)])),
        TickPageResult::Limit(_)
    ));
    assert_eq!(controller.active.as_ref().unwrap().loaded_ticks, 1);
}

fn generation(controller: &TickCacheController) -> u64 {
    controller.generation
}

#[test]
fn complete_empty_cache_hit_builds_a_final_profile_without_an_active_page() {
    let mut controller = TickCacheController::default();
    let request = tick_request(0, 1);
    controller.begin(request.clone());
    let generation = controller.generation;
    assert!(matches!(
        controller.ingest(generation, tick_snapshot(0, 1, true, vec![])),
        TickPageResult::Final(_, _)
    ));
    controller.finish();

    assert!(controller.begin(request).is_empty());
    let (snapshot, request) = controller.final_from_cache().unwrap();
    assert!(snapshot.complete);
    assert_eq!(snapshot.tick_size, "0.1");
    let state = BridgeState::with_symbol_cache_path(None);
    assert!(build_tick_profile(&state, snapshot, &request).is_ok());
    controller.finish();
    assert!(controller.active.is_none());
    assert!(controller.next_page().is_none());
}

#[test]
fn stale_generation_cannot_change_the_new_active_profile() {
    let mut controller = TickCacheController::default();
    controller.begin(tick_request(0, 10));
    let old_generation = controller.generation;
    controller.begin(tick_request(10, 20));
    let new_generation = controller.generation;

    assert!(matches!(
        controller.ingest(old_generation, tick_snapshot(0, 10, true, vec![])),
        TickPageResult::Stale
    ));
    assert!(matches!(
        controller.ingest(new_generation, tick_snapshot(10, 20, true, vec![])),
        TickPageResult::Final(_, _)
    ));
}

#[test]
fn cache_coverage_reuses_only_non_overlapping_pages_without_duplicate_ticks() {
    let mut controller = TickCacheController::default();
    controller.insert_cache(
        tick_range(0, 5),
        tick_snapshot(0, 5, true, vec![market_tick(1)]),
    );
    controller.insert_cache(
        tick_range(5, 10),
        tick_snapshot(5, 10, true, vec![market_tick(6)]),
    );
    // Exact and partial overlaps are ignored, preserving one source for
    // every cached time interval.
    controller.insert_cache(
        tick_range(0, 5),
        tick_snapshot(0, 5, true, vec![market_tick(1)]),
    );
    controller.insert_cache(
        tick_range(2, 7),
        tick_snapshot(2, 7, true, vec![market_tick(3)]),
    );

    assert_eq!(controller.entries.len(), 2);
    assert!(controller.begin(tick_request(0, 10)).is_empty());
    let (snapshot, _) = controller.final_from_cache().unwrap();
    assert_eq!(
        snapshot
            .ticks
            .iter()
            .map(|tick| tick.time_ms)
            .collect::<Vec<_>>(),
        [1, 6]
    );
}

#[test]
fn cache_reuses_and_clips_pages_that_overlap_new_range_boundaries() {
    let mut controller = TickCacheController::default();
    controller.insert_cache(
        tick_range(0, 10),
        tick_snapshot(
            0,
            10,
            true,
            vec![market_tick(1), market_tick(5), market_tick(9)],
        ),
    );

    let request = tick_request(5, 15);
    assert_eq!(controller.begin(request), vec![tick_range(10, 15)]);
    let active = controller.active.as_ref().unwrap();
    assert_eq!(active.parts[0].from_ms, 5);
    assert_eq!(active.parts[0].to_ms, 10);
    assert_eq!(
        active.parts[0]
            .ticks
            .iter()
            .map(|tick| tick.time_ms)
            .collect::<Vec<_>>(),
        [5, 9],
        "ticks outside the new half-open range must be discarded"
    );

    let TickPageResult::Final(snapshot, _) = controller.ingest(
        controller.generation,
        tick_snapshot(10, 15, true, vec![market_tick(11)]),
    ) else {
        panic!("the cached overlap and new gap should complete the range");
    };
    assert_eq!(
        snapshot
            .ticks
            .iter()
            .map(|tick| tick.time_ms)
            .collect::<Vec<_>>(),
        [5, 9, 11]
    );
}

#[test]
fn raw_cache_overlap_excludes_the_entire_summary_without_double_counting() {
    let mut controller = TickCacheController::default();
    controller.insert_cache(
        tick_range(5, 8),
        tick_snapshot(5, 8, true, (5..8).map(market_tick).collect()),
    );
    controller.price_entries.push_back(price_summary(
        tick_snapshot(2, 10, true, (2..10).map(market_tick).collect()),
        10,
    ));
    assert_eq!(
        controller.begin(tick_request(0, 20)),
        [tick_range(0, 5), tick_range(8, 20)]
    );
    assert_eq!(controller.progress().unwrap().loaded_ticks, 3);
    assert!(controller.active.as_ref().unwrap().compact.is_none());
}

#[test]
fn cache_is_fifo_bounded_and_clear_removes_all_broker_data() {
    let mut controller = TickCacheController::default();
    for index in 0..129 {
        controller.insert_cache(
            tick_range(index, index + 1),
            tick_snapshot(index, index + 1, true, vec![]),
        );
    }
    controller.cache_trim();
    assert_eq!(controller.entries.len(), 128);
    assert_eq!(controller.entries.front().unwrap().range.start_ms, 1);

    let oversized_ticks = (1000..101_001).map(market_tick).collect();
    controller.insert_cache(
        tick_range(1000, 101_001),
        tick_snapshot(1000, 101_001, true, oversized_ticks),
    );
    controller.cache_trim();
    assert!(controller.entries.len() <= 128);
    assert!(controller.cached_tick_count("NAS") <= 100_000);
    controller.clear();
    assert!(controller.entries.is_empty());
    assert!(controller.active.is_none());
}

#[test]
fn large_cached_pages_keep_the_recent_tick_budget_after_eviction() {
    for (divisor, expected_count, cached_start) in [(1, 100_000, 31_070), (3, 99_999, 10_357)] {
        let mut controller = TickCacheController::default();
        for (start, end) in [(0, 65_535), (65_535, 131_070)] {
            controller.insert_cache(
                tick_range(start / divisor, end / divisor),
                tick_snapshot(
                    start / divisor,
                    end / divisor,
                    true,
                    (start..end)
                        .map(|index| market_tick(index / divisor))
                        .collect(),
                ),
            );
        }
        controller.cache_trim();
        assert_eq!(controller.cached_tick_count("NAS"), expected_count);
        assert_eq!(
            controller.entries[0].range,
            tick_range(cached_start, 65_535 / divisor)
        );
        assert!(controller
            .begin(tick_request(cached_start, 131_070 / divisor))
            .is_empty());
        let (snapshot, _) = controller.final_from_cache().unwrap();
        assert!(snapshot.complete);
        assert_eq!(snapshot.ticks.first().unwrap().time_ms, cached_start);
        assert_eq!(snapshot.ticks.last().unwrap().time_ms, 131_069 / divisor);
    }
}

#[test]
fn multi_day_profile_streams_past_the_old_tick_cap_and_includes_late_prices() {
    let ticks = (0..600_000)
        .map(|index| {
            let mut tick = market_tick(index / 3);
            let price = if index < 300_000 {
                100 + index % 10
            } else {
                400 + index % 20
            };
            tick.bid = price.to_string();
            tick.ask = (price + 1).to_string();
            tick.flags = [2, 4, 6, 0][index as usize % 4];
            tick
        })
        .collect::<Vec<_>>();
    let mut controller = TickCacheController::default();
    let mut request = tick_request(0, 300_000);
    request.wire.max_ticks = 65535;
    request.rows = 128;
    controller.begin(request.clone());
    let mut pages = 0;
    loop {
        let (generation, page) = controller.next_page().unwrap();
        // Crossing 250k no longer reduces the wire page to one tick.
        assert_eq!(page.wire.max_ticks, 65535);
        let start = ticks.partition_point(|tick| tick.time_ms < page.wire.from_ms);
        let end = (start + usize::from(page.wire.max_ticks)).min(ticks.len());
        pages += 1;
        let result = controller.ingest(
            generation,
            tick_snapshot(
                page.wire.from_ms,
                page.wire.to_ms,
                end == ticks.len(),
                ticks[start..end].to_vec(),
            ),
        );
        assert!(controller.cached_tick_count("NAS") <= 100_000);
        if let Some(active) = &controller.active {
            assert!(
                active
                    .parts
                    .iter()
                    .map(|part| part.ticks.len())
                    .sum::<usize>()
                    <= MAX_RETAINED_PROFILE_TICKS
            );
        }
        match result {
            TickPageResult::Next(_) => {}
            TickPageResult::Streamed(compact, final_request) => {
                assert!(compact.complete);
                assert!(compact.counts.price_count() < 50);
                assert_eq!(controller.progress().unwrap().loaded_ticks, ticks.len());
                let state = BridgeState::with_symbol_cache_path(None);
                let result = build_streamed_tick_profile(&state, compact, &final_request).unwrap();
                let batch = build_tick_profile(
                    &state,
                    tick_snapshot(0, 300_000, true, ticks.clone()),
                    &request,
                )
                .unwrap();
                assert_eq!(
                    serde_json::to_value(&result).unwrap(),
                    serde_json::to_value(batch).unwrap()
                );
                assert_eq!(result.total_weight, 450_000);
                assert!(result.bins.iter().any(|bin| bin
                    .low
                    .parse::<rust_decimal::Decimal>()
                    .unwrap()
                    >= rust_decimal::Decimal::from(400)));
                break;
            }
            other => panic!("expected full streamed profile: {other:?}"),
        }
    }
    assert!(pages <= 10);
}

pub(crate) fn price_summary(
    snapshot: TickHistorySnapshot,
    through_ms: i64,
) -> trading_core::protocol::TickPriceHistorySnapshot {
    use rust_decimal::Decimal;
    use trading_core::protocol::{TickPriceCount, TickPriceHistorySnapshot};
    let mut prices = std::collections::BTreeMap::<Decimal, TickPriceCount>::new();
    let mut low: Option<Decimal> = None;
    let mut high: Option<Decimal> = None;
    let mut loaded = 0;
    let mut rejected = 0;
    for tick in snapshot
        .ticks
        .iter()
        .filter(|tick| tick.time_ms < through_ms)
    {
        loaded += 1;
        let bid = tick.bid.parse::<Decimal>().unwrap();
        let ask = tick.ask.parse::<Decimal>().unwrap();
        low = Some(low.map_or(bid.min(ask), |value| value.min(bid).min(ask)));
        high = Some(high.map_or(bid.max(ask), |value| value.max(bid).max(ask)));
        let valid = bid > Decimal::ZERO && ask > Decimal::ZERO;
        let bid_changed = tick.flags & 2 != 0;
        let ask_changed = tick.flags & 4 != 0;
        let record = prices.entry(bid).or_insert(TickPriceCount {
            price: bid.to_string(),
            total: 0,
            bid: 0,
            ask: 0,
            bid_seen: true,
        });
        record.bid_seen = true;
        if !valid {
            rejected += 1;
            continue;
        }
        if bid_changed || ask_changed {
            record.total += 1;
        }
        if bid_changed {
            record.bid += 1;
        }
        if ask_changed {
            prices
                .entry(ask)
                .or_insert(TickPriceCount {
                    price: ask.to_string(),
                    total: 0,
                    bid: 0,
                    ask: 0,
                    bid_seen: false,
                })
                .ask += 1;
        }
    }
    TickPriceHistorySnapshot {
        request_id: snapshot.request_id,
        symbol: snapshot.symbol,
        from_ms: snapshot.from_ms,
        to_ms: snapshot.to_ms,
        tick_size: snapshot.tick_size,
        complete: snapshot.complete,
        through_ms,
        loaded_ticks: loaded,
        rejected_ticks: rejected,
        min_quote: low.map(|price| price.to_string()),
        max_quote: high.map(|price| price.to_string()),
        prices: prices.into_values().collect(),
    }
}

#[test]
fn remote_price_pages_preserve_all_ticks_reuse_cache_and_never_clip_counts() {
    let ticks = (0..600_000)
        .map(|index| {
            let mut tick = market_tick(index / 3);
            let price = if index < 300_000 {
                100 + index % 10
            } else {
                400 + index % 20
            };
            tick.bid = price.to_string();
            tick.ask = (price + 1).to_string();
            tick.flags = [2, 4, 6, 0][index as usize % 4];
            tick
        })
        .collect::<Vec<_>>();
    let mut controller = TickCacheController::default();
    let mut request = tick_request(0, 300_000);
    request.wire.max_ticks = 65535;
    request.rows = 128;
    controller.begin(request.clone());
    let compact = loop {
        let (generation, page) = controller.next_page().unwrap();
        let start = ticks.partition_point(|tick| tick.time_ms < page.wire.from_ms);
        let end = (start + usize::from(page.wire.max_ticks)).min(ticks.len());
        let complete = end == ticks.len();
        let through = if complete {
            page.wire.to_ms
        } else {
            ticks[end - 1].time_ms
        };
        let raw = tick_snapshot(
            page.wire.from_ms,
            page.wire.to_ms,
            complete,
            ticks[start..end].to_vec(),
        );
        let summary = price_summary(raw, through);
        assert!(serde_json::to_vec(&summary).unwrap().len() < 4000);
        match controller.ingest_price_counts(generation, summary) {
            TickPageResult::Next(_) => {}
            TickPageResult::Streamed(compact, _) => break compact,
            other => panic!("unexpected result {other:?}"),
        }
    };
    assert_eq!(controller.progress().unwrap().loaded_ticks, 600_000);
    let state = BridgeState::with_symbol_cache_path(None);
    let batch =
        build_tick_profile(&state, tick_snapshot(0, 300_000, true, ticks), &request).unwrap();
    let streamed = build_streamed_tick_profile(&state, compact, &request).unwrap();
    assert_eq!(
        serde_json::to_value(&streamed).unwrap(),
        serde_json::to_value(batch).unwrap()
    );
    controller.finish();
    assert!(
        controller.begin(request).is_empty(),
        "repeating the entire range needs no wire pages"
    );
    let (cached, request) = controller.final_streamed_from_cache().unwrap();
    let cached = build_streamed_tick_profile(&state, cached, &request).unwrap();
    assert_eq!(
        serde_json::to_value(cached).unwrap(),
        serde_json::to_value(streamed).unwrap()
    );
    controller.finish();
    let gaps = controller.begin(tick_request(1, 199_999));
    assert_eq!(
        gaps.len(),
        2,
        "only the partial boundary pages need a fresh read"
    );
    assert_eq!(gaps[0].start_ms, 1);
    assert_eq!(gaps[1].end_ms, 199_999);
    assert!(controller.progress().unwrap().loaded_ticks > 400_000);
    let stale_generation = controller.generation;
    controller.cancel();
    let raw = tick_snapshot(1, 2, true, vec![market_tick(1)]);
    assert!(matches!(
        controller.ingest_price_counts(stale_generation, price_summary(raw, 2)),
        TickPageResult::Stale
    ));
    controller.clear();
    assert!(controller.price_entries.is_empty());
}
