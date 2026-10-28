//! Hybrid fixed-range profile: source choice, bar paging and request routing.
use super::common::*;
use super::*;
use crate::bridge::profile_bars::{BarPageOutcome, BarPhase};
use rust_decimal::Decimal;
use trading_core::protocol::{HistorySnapshot, MarketCandle};
use trading_core::volume_profile::{RowLayout, DEFAULT_VALUE_AREA_PERCENT};

pub(super) const RANGE_FROM: i64 = 1_000_000_000_000;
pub(super) const RANGE_END: i64 = RANGE_FROM + 86_400_000;
const MINUTE: i64 = 60_000;

/// Registers `symbol` (tick size and point 0.1) in the local symbol mirror.
pub(super) fn seed_symbol(state: &BridgeState, symbol: &str) {
    state
        .symbol_cache
        .lock()
        .unwrap()
        .cache
        .upsert(broker_symbol(symbol))
        .unwrap();
}

pub(super) fn profile_request() -> TickProfileRequest {
    TickProfileRequest {
        wire: TickHistoryRequest {
            symbol: "EURUSD".into(),
            from_ms: RANGE_FROM,
            to_ms: RANGE_END,
            max_ticks: 5000,
        },
        settings: ProfileSettings::default(),
    }
}

/// An up bar from 100.0 to 100.5 carrying `volume` ticks.
pub(super) fn bar(time_ms: i64, volume: u64) -> MarketCandle {
    MarketCandle {
        time_ms,
        open: "100.1".into(),
        high: "100.5".into(),
        low: "100.0".into(),
        close: "100.3".into(),
        tick_volume: volume,
        spread: 2,
        real_volume: 0,
    }
}

pub(super) fn bars_every(
    first_ms: i64,
    step_ms: i64,
    count: i64,
    volume: u64,
) -> Vec<MarketCandle> {
    (0..count)
        .map(|index| bar(first_ms + index * step_ms, volume))
        .collect()
}

pub(super) fn bar_snapshot(
    request_id: &str,
    timeframe: &str,
    before_ms: i64,
    complete: bool,
    candles: Vec<MarketCandle>,
) -> HistorySnapshot {
    HistorySnapshot {
        request_id: request_id.into(),
        symbol: "EURUSD".into(),
        timeframe: timeframe.into(),
        complete,
        candles,
        before_ms: Some(before_ms),
    }
}

fn all_timeframes() -> Vec<String> {
    [
        "M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30", "H1", "H2", "H3",
        "H4", "H6", "H8", "H12", "D1", "W1", "MN1",
    ]
    .iter()
    .map(|code| (*code).to_owned())
    .collect()
}

/// A controller with an estimate job for the standard one-day range (M2 bars).
fn estimating_controller() -> (TickCacheController, u64) {
    let mut controller = TickCacheController::default();
    controller.begin(profile_request());
    let (generation, _) = controller.begin_estimate(&all_timeframes()).unwrap();
    (controller, generation)
}

/// 721 M2 bars covering the one-day range with one bar before its start.
fn covering_m2_bars(volume: u64) -> Vec<MarketCandle> {
    bars_every(RANGE_FROM - 2 * MINUTE, 2 * MINUTE, 721, volume)
}

/// Symbol metadata cached and the production page size negotiated.
fn state_with_symbol() -> BridgeState {
    let state = BridgeState::with_symbol_cache_path(None);
    seed_symbol(&state, "EURUSD");
    *state.transfer_limits.lock().unwrap() =
        trading_core::protocol::TransferLimits::measured_default();
    state
}

fn decide(state: &BridgeState, bars: &[MarketCandle], covered: bool) -> SourceDecision {
    choose_source(state, &profile_request(), "M2", bars, covered)
}

fn choose(state: &BridgeState, bars: &[MarketCandle], covered: bool) -> ProfileSource {
    decide(state, bars, covered).source
}

#[test]
fn estimate_asks_for_the_smallest_timeframe_covering_the_range_ending_at_range_end() {
    let (controller, _) = estimating_controller();
    let job = controller.bar_job.as_ref().unwrap();
    let page = trading_core::protocol::HistoryRequest {
        symbol: "EURUSD".into(),
        timeframe: "M2".into(),
        bars: 723,
        before_ms: Some(RANGE_END),
    };
    assert_eq!(job.phase, BarPhase::Estimate);
    assert_eq!(job.timeframe, page.timeframe);
    assert_eq!(job.bars_per_page, page.bars);
    assert_eq!(job.anchor_ms, RANGE_END);
}

#[test]
fn estimate_is_skipped_when_no_supported_timeframe_covers_the_range() {
    let mut controller = TickCacheController::default();
    controller.begin(profile_request());
    assert!(controller.begin_estimate(&[]).is_none());
    assert!(controller.bar_job.is_none());
}

#[test]
fn affordable_estimate_chooses_ticks() {
    let state = state_with_symbol();
    assert_eq!(
        choose(&state, &covering_m2_bars(100), true),
        ProfileSource::Ticks
    );
}

#[test]
fn estimated_ticks_over_the_budget_choose_bars() {
    let state = state_with_symbol();
    let budget = trading_core::protocol::max_estimated_profile_ticks();
    let at_budget = vec![bar(RANGE_FROM, budget)];
    let over_budget = vec![bar(RANGE_FROM, budget + 1)];
    assert_eq!(choose(&state, &at_budget, true), ProfileSource::Ticks);
    assert_eq!(choose(&state, &over_budget, true), ProfileSource::Bars);
}

#[test]
fn estimated_distinct_prices_over_the_limit_choose_bars() {
    let state = state_with_symbol();
    let mut wide = bar(RANGE_FROM, 10);
    wide.high = "200000.0".into();
    wide.close = "100.3".into();
    assert_eq!(choose(&state, &[wide], true), ProfileSource::Bars);
}

#[test]
fn estimated_pages_over_the_limit_choose_bars_even_within_the_tick_budget() {
    let state = state_with_symbol();
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1000;
    // 3,000,000 ticks fit the tick budget but need 3000 pages of 1000 > 2048.
    let bars = vec![bar(RANGE_FROM, 3_000_000)];
    assert!(3_000_000 < trading_core::protocol::max_estimated_profile_ticks());
    assert_eq!(choose(&state, &bars, true), ProfileSource::Bars);
    let two_thousand_pages = vec![bar(RANGE_FROM, 2_048_000)];
    assert_eq!(
        choose(&state, &two_thousand_pages, true),
        ProfileSource::Ticks
    );
}

#[test]
fn estimate_failures_choose_ticks_even_when_the_load_looks_huge() {
    let huge = vec![bar(RANGE_FROM, u64::MAX)];
    let state = BridgeState::with_symbol_cache_path(None);
    // No symbol metadata cached.
    assert_eq!(choose(&state, &huge, true), ProfileSource::Ticks);
    seed_symbol(&state, "EURUSD");
    // Bars do not reach the range start.
    assert_eq!(choose(&state, &huge, false), ProfileSource::Ticks);
    // An invalid bar.
    let mut broken = bar(RANGE_FROM, u64::MAX);
    broken.low = "abc".into();
    assert_eq!(choose(&state, &[broken], true), ProfileSource::Ticks);
    // Unknown bar timeframe.
    assert_eq!(
        choose_source(&state, &profile_request(), "X9", &huge, true).source,
        ProfileSource::Ticks
    );
}

#[test]
fn every_estimate_outcome_reports_its_reason() {
    let reason =
        |state: &BridgeState, bars: &[MarketCandle], covered| decide(state, bars, covered).reason;
    let state = state_with_symbol();
    let budget = trading_core::protocol::max_estimated_profile_ticks();
    assert_eq!(
        reason(&state, &covering_m2_bars(100), true),
        SourceReason::UnderBudget
    );
    assert_eq!(
        reason(&state, &covering_m2_bars(100), false),
        SourceReason::EstimateIncomplete
    );
    assert_eq!(
        reason(&state, &[bar(RANGE_FROM, budget + 1)], true),
        SourceReason::OverTickBudget
    );
    let mut wide = bar(RANGE_FROM, 10);
    wide.high = "200000.0".into();
    wide.close = "100.3".into();
    assert_eq!(reason(&state, &[wide], true), SourceReason::OverPriceCap);
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1000;
    assert_eq!(
        reason(&state, &[bar(RANGE_FROM, 3_000_000)], true),
        SourceReason::OverPageCap
    );
    let mut broken = bar(RANGE_FROM, 1);
    broken.low = "abc".into();
    assert_eq!(
        reason(&state, &[broken], true),
        SourceReason::EstimateInvalid
    );
    let no_metadata = BridgeState::with_symbol_cache_path(None);
    assert_eq!(
        reason(&no_metadata, &covering_m2_bars(100), true),
        SourceReason::NoSymbolMetadata
    );
}

#[test]
fn estimate_decision_carries_the_figures_the_log_prints() {
    let state = state_with_symbol();
    let decision = decide(&state, &covering_m2_bars(100), true);
    assert_eq!(decision.estimate_timeframe.as_deref(), Some("M2"));
    assert_eq!(decision.estimate_bars, Some(721));
    assert_eq!(decision.load.unwrap().ticks, 72_000);
}

#[test]
fn estimate_page_reaching_the_range_start_is_reported_as_covering() {
    let (mut controller, generation) = estimating_controller();
    let snapshot = bar_snapshot("p", "M2", RANGE_END, true, covering_m2_bars(5));
    match controller.ingest_bar_page(generation, snapshot) {
        BarPageOutcome::Estimated {
            covered,
            bars,
            timeframe,
            ..
        } => {
            assert!(covered);
            assert_eq!(timeframe, "M2");
            assert_eq!(bars.len(), 721);
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(controller.bar_job.is_none());
}

#[test]
fn estimate_page_stopping_short_of_the_range_start_is_not_covering() {
    let (mut controller, generation) = estimating_controller();
    let short = bars_every(RANGE_FROM + 4 * MINUTE, 2 * MINUTE, 10, 5);
    match controller.ingest_bar_page(generation, bar_snapshot("p", "M2", RANGE_END, true, short)) {
        BarPageOutcome::Estimated { covered, .. } => assert!(!covered),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn estimate_page_with_exhausted_history_counts_as_covering() {
    let (mut controller, generation) = estimating_controller();
    let short = bars_every(RANGE_FROM + 4 * MINUTE, 2 * MINUTE, 10, 5);
    match controller.ingest_bar_page(generation, bar_snapshot("p", "M2", RANGE_END, false, short)) {
        BarPageOutcome::Estimated { covered, .. } => assert!(covered),
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn invalid_estimate_page_fails_in_the_estimate_phase() {
    let (mut controller, generation) = estimating_controller();
    let mut snapshot = bar_snapshot("p", "M2", RANGE_END, true, covering_m2_bars(5));
    snapshot.symbol = "OTHER".into();
    match controller.ingest_bar_page(generation, snapshot) {
        BarPageOutcome::Failed { phase, .. } => assert_eq!(phase, BarPhase::Estimate),
        other => panic!("unexpected {other:?}"),
    }
    assert!(controller.bar_job.is_none());
}

fn collecting_controller() -> (TickCacheController, u64) {
    let mut controller = TickCacheController::default();
    controller.begin(profile_request());
    let (generation, first) = controller
        .begin_collect(profile_request(), &all_timeframes())
        .unwrap();
    assert_eq!(first.timeframe, "M1");
    assert_eq!(first.bars, 1000);
    assert_eq!(first.before_ms, Some(RANGE_END));
    (controller, generation)
}

#[test]
fn collect_discards_the_tick_state() {
    let (controller, _) = collecting_controller();
    assert!(controller.active.is_none());
}

#[test]
fn collect_pages_back_until_the_oldest_bar_opens_at_or_before_the_range_start() {
    let (mut controller, generation) = collecting_controller();
    let first_page = bars_every(RANGE_END - 1000 * MINUTE, MINUTE, 1000, 3);
    let (next_generation, next, progress) = match controller.ingest_bar_page(
        generation,
        bar_snapshot("p1", "M1", RANGE_END, true, first_page),
    ) {
        BarPageOutcome::Next(generation, request, progress) => (generation, request, progress),
        other => panic!("unexpected {other:?}"),
    };
    assert_eq!(next_generation, generation);
    assert_eq!(next.before_ms, Some(RANGE_END - 1000 * MINUTE));
    assert_eq!(progress.completed_pages, 1);
    assert!(progress.pending_pages >= 1);
    assert_eq!(progress.loaded_ticks, 3000);
    // The last page's oldest bar opens exactly at the range start: stop.
    let second_page = bars_every(RANGE_FROM, MINUTE, 440, 3);
    match controller.ingest_bar_page(
        generation,
        bar_snapshot("p2", "M1", RANGE_END - 1000 * MINUTE, true, second_page),
    ) {
        BarPageOutcome::Collected {
            bars, timeframe, ..
        } => {
            assert_eq!(timeframe, "M1");
            assert_eq!(bars.len(), 1440);
            assert!(bars
                .windows(2)
                .all(|pair| pair[0].time_ms < pair[1].time_ms));
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(controller.bar_job.is_none());
}

#[test]
fn collect_stops_when_history_runs_out_before_the_range_start() {
    let (mut controller, generation) = collecting_controller();
    let page = bars_every(RANGE_END - 10 * MINUTE, MINUTE, 10, 3);
    // History ends inside the range: a coarser timeframe is tried for the
    // whole range before anything is reported.
    match controller.ingest_bar_page(generation, bar_snapshot("p1", "M1", RANGE_END, false, page)) {
        BarPageOutcome::Retry {
            request,
            exhausted_timeframe,
            oldest_ms,
            ..
        } => {
            assert_eq!(exhausted_timeframe, "M1");
            assert_eq!(oldest_ms, Some(RANGE_END - 10 * MINUTE));
            assert_eq!(request.timeframe, "M2");
            assert_eq!(request.before_ms, Some(RANGE_END));
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn collect_stops_on_an_empty_page() {
    let (mut controller, generation) = collecting_controller();
    match controller.ingest_bar_page(
        generation,
        bar_snapshot("p1", "M1", RANGE_END, true, vec![]),
    ) {
        BarPageOutcome::Retry {
            exhausted_timeframe,
            oldest_ms,
            ..
        } => {
            assert_eq!(exhausted_timeframe, "M1");
            assert_eq!(oldest_ms, None);
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn collect_fails_when_a_page_is_not_older_than_the_anchor() {
    let (mut controller, generation) = collecting_controller();
    let page = bars_every(RANGE_END - 5 * MINUTE, MINUTE, 6, 3);
    match controller.ingest_bar_page(generation, bar_snapshot("p1", "M1", RANGE_END, true, page)) {
        BarPageOutcome::Failed { phase, .. } => assert_eq!(phase, BarPhase::Collect),
        other => panic!("unexpected {other:?}"),
    }
    assert!(controller.bar_job.is_none());
}

#[test]
fn collect_fails_after_the_page_bound() {
    let (mut controller, generation) = collecting_controller();
    let mut anchor = RANGE_END;
    for index in 0..crate::bridge::MAX_PROFILE_BAR_PAGES {
        let page = bars_every(anchor - 1000 * MINUTE, MINUTE, 1000, 1);
        let snapshot = bar_snapshot("p", "M1", anchor, true, page);
        anchor -= 1000 * MINUTE;
        // The range is a day, so shift it far back to keep walking.
        match controller.ingest_bar_page(generation, snapshot) {
            BarPageOutcome::Next(..) if index + 1 < crate::bridge::MAX_PROFILE_BAR_PAGES => {}
            BarPageOutcome::Failed { phase, message, .. } => {
                assert_eq!(index + 1, crate::bridge::MAX_PROFILE_BAR_PAGES);
                assert_eq!(phase, BarPhase::Collect);
                assert!(message.contains("bar pages"));
                return;
            }
            BarPageOutcome::Collected { .. } | BarPageOutcome::Retry { .. } => return, // reached the day start first
            other => panic!("unexpected {other:?}"),
        }
    }
    panic!("page bound never applied");
}

#[test]
fn bar_pages_of_a_superseded_generation_are_ignored() {
    let (mut controller, generation) = estimating_controller();
    controller.begin(profile_request());
    let snapshot = bar_snapshot("p", "M2", RANGE_END, true, covering_m2_bars(5));
    assert!(matches!(
        controller.ingest_bar_page(generation, snapshot),
        BarPageOutcome::Stale
    ));
}

#[test]
fn cancelling_the_profile_invalidates_the_bar_job() {
    let (mut controller, generation) = collecting_controller();
    assert!(controller.cancelled_view().is_some());
    controller.cancel();
    assert!(!controller.bar_request_is_current(generation));
    let page = bars_every(RANGE_END - 10 * MINUTE, MINUTE, 10, 3);
    assert!(matches!(
        controller.ingest_bar_page(generation, bar_snapshot("p", "M1", RANGE_END, true, page)),
        BarPageOutcome::Stale
    ));
}

#[test]
fn a_bar_job_for_another_symbol_is_dropped_on_symbol_change() {
    let (mut controller, _) = collecting_controller();
    assert!(!controller.drop_bar_job_for_other_symbol(Some("EURUSD")));
    assert!(controller.drop_bar_job_for_other_symbol(Some("GBPUSD")));
    assert!(controller.bar_job.is_none());
}

#[test]
fn bar_profile_clips_to_the_range_and_labels_its_source() {
    let state = state_with_symbol();
    // One bar wholly before, two overlapping the edges, one in the middle, one after.
    let bars = vec![
        bar(RANGE_FROM - 2 * MINUTE, 1000),
        bar(RANGE_FROM - MINUTE / 2, 10),
        bar(RANGE_FROM + 5 * MINUTE, 20),
        bar(RANGE_END - MINUTE / 2, 30),
        bar(RANGE_END, 2000),
    ];
    let result = build_bar_profile(&state, &profile_request(), "M1", &bars).unwrap();
    assert_eq!(result.total_weight, 60);
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["source"], "bars");
    assert_eq!(value["barTimeframe"], "M1");
    assert_eq!(value["fromMs"], RANGE_FROM);
    assert_eq!(value["endMs"], RANGE_END);
    // Up bars land in the ask series.
    assert_eq!(result.bins.iter().map(|bin| bin.ask).sum::<u64>(), 60);
    assert_eq!(result.bins.iter().map(|bin| bin.bid).sum::<u64>(), 0);
}

#[test]
fn bar_profile_needs_the_symbol_tick_size() {
    let state = BridgeState::with_symbol_cache_path(None);
    assert!(build_bar_profile(&state, &profile_request(), "M1", &[]).is_err());
}

#[test]
fn tick_profiles_report_ticks_as_their_source() {
    let state = BridgeState::with_symbol_cache_path(None);
    let wire = profile_request().wire;
    let result = build_tick_profile(
        &state,
        TickHistorySnapshot {
            request_id: "r".into(),
            symbol: wire.symbol.clone(),
            from_ms: wire.from_ms,
            to_ms: wire.to_ms,
            tick_size: "0.1".into(),
            complete: true,
            ticks: vec![],
        },
        &profile_request(),
    )
    .unwrap();
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value["source"], "ticks");
    assert!(value["barTimeframe"].is_null());
    assert!(value["coveredFromMs"].is_null());
}

fn connected_state() -> BridgeState {
    let state = BridgeState::with_symbol_cache_path(None);
    *state.current_session.lock().unwrap() = Some("session-1".into());
    state.status.lock().unwrap().supported_timeframes = all_timeframes();
    state.market.lock().unwrap().symbol = Some("EURUSD".into());
    state
}

fn start(state: &BridgeState) {
    start_with(state, RowLayout::default(), DEFAULT_VALUE_AREA_PERCENT).unwrap();
}

fn start_with(
    state: &BridgeState,
    layout: RowLayout,
    value_area_percent: u8,
) -> Result<(), String> {
    request_tick_profile_inner(
        state,
        "EURUSD".into(),
        RANGE_FROM,
        RANGE_END,
        layout,
        value_area_percent,
    )
    .map(|_| ())
}

#[test]
fn tick_load_carries_the_requested_settings() {
    let state = connected_state();
    let layout = RowLayout::TicksPerRow { ticks: 4 };
    start_with(&state, layout, 55).unwrap();
    let queued = state.pending_tick_profile.lock().unwrap().clone().unwrap();
    assert_eq!(queued.settings.layout, layout);
    assert_eq!(queued.settings.value_area, Decimal::new(55, 2));
}

#[test]
fn bar_estimate_carries_the_requested_settings() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    let layout = RowLayout::TicksPerRow { ticks: 4 };
    start_with(&state, layout, 55).unwrap();
    let request = state
        .tick_controller
        .lock()
        .unwrap()
        .bar_job_request()
        .unwrap();
    assert_eq!(request.settings.layout, layout);
    assert_eq!(request.settings.value_area, Decimal::new(55, 2));
}

#[test]
fn profile_request_with_invalid_settings_queues_nothing() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    let invalid = [
        (
            RowLayout::Rows { count: 0 },
            70,
            "rows must be between 1 and 128",
        ),
        (
            RowLayout::Rows { count: 129 },
            70,
            "rows must be between 1 and 128",
        ),
        (
            RowLayout::TicksPerRow { ticks: 0 },
            70,
            "ticks per row must be between 1 and 1000",
        ),
        (
            RowLayout::TicksPerRow { ticks: 1001 },
            70,
            "ticks per row must be between 1 and 1000",
        ),
        (
            RowLayout::default(),
            0,
            "value area percent must be between 1 and 100",
        ),
        (
            RowLayout::default(),
            101,
            "value area percent must be between 1 and 100",
        ),
    ];
    for (layout, percent, message) in invalid {
        assert_eq!(start_with(&state, layout, percent), Err(message.to_owned()));
    }
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.pending_tick_profile.lock().unwrap().is_none());
}

#[test]
fn bar_profile_follows_the_requested_layout_and_value_area() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    let mut request = profile_request();
    request.settings.layout = RowLayout::TicksPerRow { ticks: 2 };
    let bars = vec![bar(RANGE_FROM, 10)];
    let result = build_bar_profile(&state, &request, "M5", &bars).unwrap();
    // 100.0..100.5 at tick 0.1 is 6 cells; 2 ticks per row gives 3 rows.
    assert_eq!(result.actual_rows, 3);
}

#[test]
fn profile_request_with_symbol_metadata_queues_the_estimate_not_the_ticks() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    start(&state);
    let (_, page) = state.pending_profile_bars.lock().unwrap().clone().unwrap();
    assert_eq!(page.timeframe, "M2");
    assert_eq!(page.before_ms, Some(RANGE_END));
    assert!(state.pending_tick_profile.lock().unwrap().is_none());
}

#[test]
fn profile_request_without_symbol_metadata_loads_ticks_directly() {
    let state = connected_state();
    start(&state);
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.pending_tick_profile.lock().unwrap().is_some());
}

#[test]
fn profile_bar_requests_never_touch_the_chart_history_page_slots() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    let chart_page = trading_core::protocol::HistoryRequest {
        symbol: "EURUSD".into(),
        timeframe: "M5".into(),
        bars: 300,
        before_ms: Some(5),
    };
    *state.pending_history_page.lock().unwrap() = Some(chart_page.clone());
    *state.expected_history_page.lock().unwrap() =
        Some(("rust-history-page-9".into(), chart_page.clone()));
    start(&state);
    assert_eq!(
        *state.pending_history_page.lock().unwrap(),
        Some(chart_page.clone())
    );
    assert_eq!(
        state.expected_history_page.lock().unwrap().clone(),
        Some(("rust-history-page-9".into(), chart_page))
    );
    // And the profile's slots are cleared by a cancel without disturbing the chart's.
    crate::bridge::commands::cancel_active_tick_profile(&state);
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.expected_history_page.lock().unwrap().is_some());
}

#[test]
fn new_profile_request_and_cancel_clear_the_queued_bar_request() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    start(&state);
    let (first_generation, _) = state.pending_profile_bars.lock().unwrap().clone().unwrap();
    start(&state);
    let (second_generation, _) = state.pending_profile_bars.lock().unwrap().clone().unwrap();
    assert!(second_generation > first_generation);
    crate::bridge::commands::cancel_active_tick_profile(&state);
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.expected_profile_bars.lock().unwrap().is_none());
}

#[test]
fn timeframe_switch_keeps_the_same_symbol_profile_load_running() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    start(&state);
    let queued = state.pending_profile_bars.lock().unwrap().clone();

    let cancelled =
        crate::bridge::commands::request_history_inner(&state, "EURUSD".into(), "M15".into(), 300)
            .unwrap();

    // Profile data is timeframe-independent: nothing to cancel, nothing dropped.
    assert!(cancelled.is_none());
    assert_eq!(*state.pending_profile_bars.lock().unwrap(), queued);
    assert!(state
        .tick_controller
        .lock()
        .unwrap()
        .cancelled_view()
        .is_some());
    assert_eq!(
        state
            .pending_history
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| r.timeframe.as_str()),
        Some("M15")
    );
}

#[test]
fn history_for_another_symbol_drops_the_profile_and_reports_the_cancellation() {
    let state = connected_state();
    seed_symbol(&state, "EURUSD");
    start(&state);

    let cancelled =
        crate::bridge::commands::request_history_inner(&state, "GBPUSD".into(), "M1".into(), 300)
            .unwrap()
            .expect("the awaited profile request must end with a cancellation");

    assert_eq!(cancelled.symbol, "EURUSD");
    assert_eq!(cancelled.from_ms, RANGE_FROM);
    assert_eq!(cancelled.end_ms, RANGE_END);
    assert!(state.pending_profile_bars.lock().unwrap().is_none());
    assert!(state.pending_tick_profile.lock().unwrap().is_none());
    assert!(state
        .tick_controller
        .lock()
        .unwrap()
        .cancelled_view()
        .is_none());
}

#[test]
fn config_budget_is_within_sane_bounds() {
    let budget = trading_core::protocol::max_estimated_profile_ticks();
    assert!(budget >= 1_000_000);
    assert!(budget <= 1_000_000_000);
}

// ---- Bar cache: a refresh fetches only what the cache lacks ----

use trading_core::protocol::HistoryRequest;
use trading_core::volume_profile::{bars_overlapping_range, BarSeries};

const CACHE_TEST_BARS_BEFORE: i64 = 5_000;

fn request_between(from_ms: i64, to_ms: i64) -> TickProfileRequest {
    let mut request = profile_request();
    request.wire.from_ms = from_ms;
    request.wire.to_ms = to_ms;
    request
}

/// The broker's M1 history: one bar per minute from far before the range until
/// `last_open_ms`, each carrying `volume` ticks.
fn broker_history(last_open_ms: i64, volume: u64) -> Vec<MarketCandle> {
    let first = RANGE_FROM - CACHE_TEST_BARS_BEFORE * MINUTE;
    bars_every(first, MINUTE, (last_open_ms - first) / MINUTE + 1, volume)
}

/// Plays the EA for one collecting job: answers each page from `history` and
/// returns the collected bars with the requests that were sent.
fn serve_collect(
    controller: &mut TickCacheController,
    history: &[MarketCandle],
    request: &TickProfileRequest,
) -> (Vec<MarketCandle>, Vec<HistoryRequest>) {
    let mut sent = Vec::new();
    let (generation, mut page) = controller
        .begin_collect(request.clone(), &all_timeframes())
        .unwrap();
    loop {
        let before = page.before_ms.unwrap();
        let older: Vec<&MarketCandle> = history.iter().filter(|b| b.time_ms < before).collect();
        let start = older.len().saturating_sub(usize::from(page.bars));
        let candles: Vec<MarketCandle> = older[start..].iter().map(|b| (*b).clone()).collect();
        let complete = start > 0;
        sent.push(page.clone());
        let snapshot = bar_snapshot("p", &page.timeframe, before, complete, candles);
        match controller.ingest_bar_page(generation, snapshot) {
            BarPageOutcome::Next(_, next, _) => page = next,
            BarPageOutcome::Collected { bars, .. } => return (bars, sent),
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn fresh_collect(history: &[MarketCandle], request: &TickProfileRequest) -> Vec<MarketCandle> {
    serve_collect(&mut TickCacheController::default(), history, request).0
}

#[test]
fn refreshing_an_open_range_fetches_only_the_newest_page() {
    let mut controller = TickCacheController::default();
    let first = request_between(RANGE_FROM, RANGE_END);
    let (first_bars, first_pages) = serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &first,
    );
    assert_eq!(first_pages.len(), 2);
    assert_eq!(first_bars.len(), 1440);

    // Two seconds later: the forming bar grew and one new bar opened.
    let history = {
        let mut history = broker_history(RANGE_END, 3);
        let forming = history.len() - 2;
        history[forming].tick_volume = 50;
        history
    };
    let refreshed = request_between(RANGE_FROM, RANGE_END + MINUTE);
    let (bars, pages) = serve_collect(&mut controller, &history, &refreshed);
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].before_ms, Some(RANGE_END + MINUTE));
    assert_eq!(bars, fresh_collect(&history, &refreshed));
    // The previously newest bar was replaced, not kept.
    let replaced = bars
        .iter()
        .find(|b| b.time_ms == RANGE_END - MINUTE)
        .unwrap();
    assert_eq!(replaced.tick_volume, 50);
}

#[test]
fn refresh_after_a_short_pause_pages_back_until_it_meets_the_cached_series() {
    let mut controller = TickCacheController::default();
    let first = request_between(RANGE_FROM, RANGE_END);
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &first,
    );

    // 1500 new bars: the newest page does not reach the cache, the next does.
    let history = broker_history(RANGE_END + 1499 * MINUTE, 3);
    let refreshed = request_between(RANGE_FROM, RANGE_END + 1500 * MINUTE);
    let (bars, pages) = serve_collect(&mut controller, &history, &refreshed);
    assert_eq!(pages.len(), 2);
    assert_eq!(bars, fresh_collect(&history, &refreshed));
}

#[test]
fn range_extended_backwards_fetches_only_older_pages() {
    let mut controller = TickCacheController::default();
    let history = broker_history(RANGE_END + 10 * MINUTE, 3);
    let first = request_between(RANGE_FROM, RANGE_END);
    serve_collect(&mut controller, &history, &first);

    let longer = request_between(RANGE_FROM - 2000 * MINUTE, RANGE_END - 5 * MINUTE);
    let (bars, pages) = serve_collect(&mut controller, &history, &longer);
    // The range ends before the cached newest bar: only older pages, starting
    // at the oldest bar the first walk left in the cache (two full pages).
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].before_ms, Some(RANGE_END - 2000 * MINUTE));
    assert_eq!(bars, fresh_collect(&history, &longer));
}

#[test]
fn growing_the_range_in_both_directions_fetches_newer_then_older_pages() {
    let mut controller = TickCacheController::default();
    let history = broker_history(RANGE_END + 10 * MINUTE, 3);
    serve_collect(
        &mut controller,
        &history,
        &request_between(RANGE_FROM, RANGE_END),
    );
    let wider = request_between(RANGE_FROM - 1500 * MINUTE, RANGE_END + 5 * MINUTE);
    let (bars, pages) = serve_collect(&mut controller, &history, &wider);
    assert_eq!(pages.len(), 1 + 1);
    assert_eq!(pages[0].before_ms, Some(RANGE_END + 5 * MINUTE));
    assert_eq!(bars, fresh_collect(&history, &wider));
}

#[test]
fn a_closed_range_inside_the_cached_series_needs_no_request() {
    let mut controller = TickCacheController::default();
    let history = broker_history(RANGE_END + 10 * MINUTE, 3);
    serve_collect(
        &mut controller,
        &history,
        &request_between(RANGE_FROM, RANGE_END),
    );
    let inside = request_between(RANGE_FROM + 60 * MINUTE, RANGE_END - 60 * MINUTE);
    let (timeframe, bars) = controller
        .cached_bars_for(&inside, &all_timeframes())
        .unwrap();
    assert_eq!(timeframe, "M1");
    let expected = bars_overlapping_range(&bars, "M1", inside.wire.from_ms, inside.wire.to_ms);
    let fresh = bars_overlapping_range(
        &fresh_collect(&history, &inside),
        "M1",
        inside.wire.from_ms,
        inside.wire.to_ms,
    );
    assert_eq!(expected, fresh);
    // A live range still needs the newest bar.
    let live = request_between(RANGE_FROM, RANGE_END + 3 * MINUTE);
    assert!(controller
        .cached_bars_for(&live, &all_timeframes())
        .is_none());
}

#[test]
fn a_pause_longer_than_the_bridge_bound_drops_the_cache_and_fetches_fresh() {
    let mut controller = TickCacheController::default();
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    let gap_bars = i64::try_from(crate::bridge::MAX_CACHE_BRIDGE_PAGES).unwrap() * 1000 + 500;
    let history = broker_history(RANGE_END + gap_bars * MINUTE, 3);
    let refreshed = request_between(RANGE_FROM, RANGE_END + (gap_bars + 1) * MINUTE);
    let (bars, pages) = serve_collect(&mut controller, &history, &refreshed);
    assert_eq!(bars, fresh_collect(&history, &refreshed));
    // The fresh walk reuses the pages already held: no more than a plain fetch.
    assert_eq!(
        pages.len(),
        serve_collect(&mut TickCacheController::default(), &history, &refreshed)
            .1
            .len()
    );
    let replaced = controller.bar_cache.get("EURUSD", "M1").unwrap();
    assert_eq!(replaced.newest_ms(), RANGE_END + gap_bars * MINUTE);
}

#[test]
fn a_cache_entirely_before_the_new_range_is_replaced_by_a_fresh_series() {
    let mut controller = TickCacheController::default();
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    let history = broker_history(RANGE_END + 3000 * MINUTE, 3);
    let later = request_between(RANGE_END + 1000 * MINUTE, RANGE_END + 2000 * MINUTE);
    let (bars, _) = serve_collect(&mut controller, &history, &later);
    assert_eq!(bars, fresh_collect(&history, &later));
    assert!(
        controller
            .bar_cache
            .get("EURUSD", "M1")
            .unwrap()
            .oldest_ms()
            > RANGE_END
    );
}

#[test]
fn a_cached_series_that_disagrees_with_the_broker_is_dropped_and_refetched() {
    let mut controller = TickCacheController::default();
    let history = broker_history(RANGE_END + 10 * MINUTE, 3);
    let mut corrupt: Vec<MarketCandle> = history
        .iter()
        .filter(|b| b.time_ms >= RANGE_FROM && b.time_ms < RANGE_END)
        .cloned()
        .collect();
    // A bar the broker never listed, inside the span the refresh re-reads.
    corrupt.insert(corrupt.len() - 1, bar(RANGE_END - MINUTE - 20_000, 77));
    corrupt.sort_by_key(|b| b.time_ms);
    controller
        .bar_cache
        .store("EURUSD", BarSeries::new("M1", corrupt, false).unwrap());
    let refreshed = request_between(RANGE_FROM, RANGE_END + MINUTE);
    let (bars, _) = serve_collect(&mut controller, &history, &refreshed);
    assert_eq!(bars, fresh_collect(&history, &refreshed));
    assert!(bars.iter().all(|b| b.tick_volume != 77));
}

#[test]
fn cache_survives_a_new_request_and_cancel_but_not_session_end_or_clear() {
    let mut controller = TickCacheController::default();
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    controller.begin(profile_request());
    controller.cancel();
    assert_eq!(controller.bar_cache.len(), 1);
    controller.end_session();
    assert_eq!(controller.bar_cache.len(), 0);

    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    controller.clear();
    assert_eq!(controller.bar_cache.len(), 0);
}

#[test]
fn symbol_change_drops_cached_bars_of_other_symbols() {
    let mut controller = TickCacheController::default();
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    controller.drop_bar_job_for_other_symbol(Some("EURUSD"));
    assert_eq!(controller.bar_cache.len(), 1);
    controller.drop_bar_job_for_other_symbol(Some("GBPUSD"));
    assert_eq!(controller.bar_cache.len(), 0);
}

fn tiny_series(timeframe: &str) -> BarSeries {
    BarSeries::new(timeframe, vec![bar(RANGE_FROM, 1)], false).unwrap()
}

#[test]
fn the_cache_holds_a_bounded_number_of_series_and_evicts_the_least_recently_used() {
    let mut cache = crate::bridge::ProfileBarCache::default();
    for timeframe in ["M1", "M5", "M15"] {
        cache.store("EURUSD", tiny_series(timeframe));
    }
    assert_eq!(cache.len(), crate::bridge::MAX_CACHED_BAR_SERIES);
    // Re-storing M1 makes it the newest; M5 is now the oldest.
    cache.store("EURUSD", tiny_series("M1"));
    cache.store("EURUSD", tiny_series("H1"));
    assert_eq!(cache.len(), crate::bridge::MAX_CACHED_BAR_SERIES);
    assert!(cache.get("EURUSD", "M5").is_none());
    for kept in ["M1", "M15", "H1"] {
        assert!(cache.get("EURUSD", kept).is_some(), "{kept}");
    }
}

#[test]
fn a_stored_series_is_trimmed_to_the_profile_bar_bound_keeping_the_newest() {
    let limit = i64::try_from(crate::bridge::MAX_PROFILE_BARS).unwrap();
    let bars = bars_every(0, MINUTE, limit + 5, 1);
    let newest = bars.last().unwrap().time_ms;
    let mut cache = crate::bridge::ProfileBarCache::default();
    cache.store("EURUSD", BarSeries::new("M1", bars, true).unwrap());
    let held = cache.get("EURUSD", "M1").unwrap();
    assert_eq!(i64::try_from(held.len()).unwrap(), limit);
    assert_eq!(held.newest_ms(), newest);
    assert!(!held.history_start_reached());
}

#[test]
fn a_range_needing_another_timeframe_does_not_use_the_cached_series() {
    let mut controller = TickCacheController::default();
    serve_collect(
        &mut controller,
        &broker_history(RANGE_END - MINUTE, 3),
        &request_between(RANGE_FROM, RANGE_END),
    );
    // Months of M1 exceed the bar bound, so a coarser timeframe is chosen.
    let wide = request_between(RANGE_FROM - 400 * 86_400_000, RANGE_END);
    let (_, first) = controller.begin_collect(wide, &all_timeframes()).unwrap();
    assert_ne!(first.timeframe, "M1");
    assert_eq!(first.before_ms, Some(RANGE_END));
    assert!(!controller.bar_job.as_ref().unwrap().uses_cache);
}

// ---- History that ends inside the range: coarser retry and partial coverage ----

use trading_core::volume_profile::partial_coverage_start;

/// Bars of `timeframe` every bar length from `first_ms` (not aligned to the
/// timeframe grid, so tests control exactly where a history starts) up to the
/// range end.
fn history_starting_at(timeframe: &str, first_ms: i64) -> Vec<MarketCandle> {
    let step = i64::from(trading_core::protocol::timeframe_seconds(timeframe).unwrap()) * 1000;
    bars_every(first_ms, step, (RANGE_END - first_ms) / step + 1, 3)
}

const HOUR: i64 = 60 * MINUTE;

/// What the EA did for one profile: the requests it saw, the retries it
/// announced and the profile bars it ended with.
struct Played {
    sent: Vec<HistoryRequest>,
    retries: Vec<(String, Option<i64>, String)>,
    bars: Vec<MarketCandle>,
    timeframe: String,
}

impl Played {
    fn timeframes_asked(&self) -> Vec<&str> {
        let mut asked: Vec<&str> = Vec::new();
        for page in &self.sent {
            if asked.last() != Some(&page.timeframe.as_str()) {
                asked.push(&page.timeframe);
            }
        }
        asked
    }
}

/// Plays the EA for one collecting profile whose history per timeframe comes
/// from `history_for`.
fn play_profile(
    controller: &mut TickCacheController,
    request: &TickProfileRequest,
    history_for: &dyn Fn(&str) -> Vec<MarketCandle>,
) -> Played {
    let mut played = Played {
        sent: Vec::new(),
        retries: Vec::new(),
        bars: Vec::new(),
        timeframe: String::new(),
    };
    let (generation, mut page) = controller
        .begin_collect(request.clone(), &all_timeframes())
        .unwrap();
    loop {
        let before = page.before_ms.unwrap();
        let history = history_for(&page.timeframe);
        let older: Vec<&MarketCandle> = history.iter().filter(|b| b.time_ms < before).collect();
        let start = older.len().saturating_sub(usize::from(page.bars));
        let candles: Vec<MarketCandle> = older[start..].iter().map(|b| (*b).clone()).collect();
        played.sent.push(page.clone());
        let snapshot = bar_snapshot("p", &page.timeframe, before, start > 0, candles);
        match controller.ingest_bar_page(generation, snapshot) {
            BarPageOutcome::Next(_, next, _) => page = next,
            BarPageOutcome::Retry {
                request: next,
                exhausted_timeframe,
                oldest_ms,
                ..
            } => {
                played
                    .retries
                    .push((exhausted_timeframe, oldest_ms, next.timeframe.clone()));
                page = next;
            }
            BarPageOutcome::Collected {
                bars, timeframe, ..
            } => {
                played.bars = bars;
                played.timeframe = timeframe;
                return played;
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn is_minute_timeframe(timeframe: &str) -> bool {
    timeframe.starts_with('M')
}

#[test]
fn exhausted_history_retries_a_coarser_timeframe_for_the_whole_range_and_covers_it() {
    let mut controller = TickCacheController::default();
    // Minute timeframes only start six hours into the range; hourly bars go
    // back before it.
    let history = |timeframe: &str| {
        let start = if is_minute_timeframe(timeframe) {
            RANGE_FROM + 6 * HOUR
        } else {
            RANGE_FROM - 10 * HOUR
        };
        history_starting_at(timeframe, start)
    };
    let played = play_profile(
        &mut controller,
        &request_between(RANGE_FROM, RANGE_END),
        &history,
    );
    assert_eq!(played.timeframe, "H1");
    assert_eq!(partial_coverage_start(&played.bars, RANGE_FROM), None);
    // Every retry walked the whole range from its end, one timeframe only.
    let retried: Vec<&str> = played.retries.iter().map(|r| r.0.as_str()).collect();
    assert_eq!(retried, ["M1", "M2", "M4", "M10", "M20"]);
    assert_eq!(played.retries[0].1, Some(RANGE_FROM + 6 * HOUR));
    assert_eq!(played.retries[0].2, "M2");
    assert!(played
        .bars
        .iter()
        .all(|b| b.time_ms % HOUR == (RANGE_FROM - 10 * HOUR) % HOUR));
    let first_pages: Vec<(&str, Option<i64>)> = played
        .sent
        .windows(2)
        .filter(|pair| pair[0].timeframe != pair[1].timeframe)
        .map(|pair| (pair[1].timeframe.as_str(), pair[1].before_ms))
        .collect();
    assert!(first_pages
        .iter()
        .all(|(_, before)| *before == Some(RANGE_END)));
}

#[test]
fn when_no_timeframe_reaches_the_start_the_furthest_back_wins_and_the_result_is_partial() {
    let mut controller = TickCacheController::default();
    // H4 reaches furthest back (a full H4 bar before the minute timeframes);
    // D1 and H8 start later.
    let history = |timeframe: &str| {
        let start = match timeframe {
            "H4" => RANGE_FROM + HOUR,
            "H8" => RANGE_FROM + 3 * HOUR,
            "D1" => RANGE_FROM + 5 * HOUR,
            _ => RANGE_FROM + 6 * HOUR,
        };
        history_starting_at(timeframe, start)
    };
    let played = play_profile(
        &mut controller,
        &request_between(RANGE_FROM, RANGE_END),
        &history,
    );
    assert_eq!(played.timeframe, "H4");
    assert_eq!(
        partial_coverage_start(&played.bars, RANGE_FROM),
        Some(RANGE_FROM + HOUR)
    );
    assert_eq!(
        played.timeframes_asked(),
        ["M1", "M2", "M4", "M10", "M20", "H1", "H2", "H4", "H8", "D1"]
    );
}

#[test]
fn equally_far_back_histories_choose_the_finest_timeframe() {
    let mut controller = TickCacheController::default();
    // Coarser bars open earlier only because they align to their grid (less
    // than one of their bars): that is the same history, so keep the finest.
    let history = |timeframe: &str| {
        let step = i64::from(trading_core::protocol::timeframe_seconds(timeframe).unwrap()) * 1000;
        history_starting_at(timeframe, RANGE_FROM + 6 * HOUR - (step / 2).min(HOUR))
    };
    let played = play_profile(
        &mut controller,
        &request_between(RANGE_FROM, RANGE_END),
        &history,
    );
    assert_eq!(played.timeframe, "M1");
    assert!(partial_coverage_start(&played.bars, RANGE_FROM).is_some());
}

#[test]
fn retries_are_bounded_and_stop_at_the_coarsest_retry_timeframe() {
    let mut controller = TickCacheController::default();
    let history = |timeframe: &str| history_starting_at(timeframe, RANGE_FROM + 6 * HOUR);
    let played = play_profile(
        &mut controller,
        &request_between(RANGE_FROM, RANGE_END),
        &history,
    );
    assert!(played.retries.len() <= crate::bridge::MAX_HISTORY_RETRIES);
    let asked = played.timeframes_asked();
    assert!(asked.len() <= 1 + crate::bridge::MAX_HISTORY_RETRIES);
    assert_eq!(asked.last(), Some(&"D1"));
    assert!(!asked.contains(&"W1") && !asked.contains(&"MN1"));
}

#[test]
fn a_response_for_a_superseded_generation_during_a_retry_is_ignored() {
    let (mut controller, generation) = collecting_controller();
    let page = bars_every(RANGE_END - 10 * MINUTE, MINUTE, 10, 3);
    let outcome =
        controller.ingest_bar_page(generation, bar_snapshot("p1", "M1", RANGE_END, false, page));
    assert!(matches!(outcome, BarPageOutcome::Retry { .. }));
    assert_eq!(controller.bar_job.as_ref().unwrap().timeframe, "M2");

    // A new profile starts while the M2 retry is in flight.
    controller.begin(profile_request());
    let late = bar_snapshot(
        "p2",
        "M2",
        RANGE_END,
        true,
        bars_every(RANGE_FROM, 2 * MINUTE, 5, 1),
    );
    assert!(matches!(
        controller.ingest_bar_page(generation, late),
        BarPageOutcome::Stale
    ));
    assert!(controller.bar_job.is_none());
}

#[test]
fn known_exhausted_history_is_not_walked_again_by_a_repeat_request() {
    let mut controller = TickCacheController::default();
    let history = |timeframe: &str| {
        let start = match timeframe {
            "H4" => RANGE_FROM + HOUR,
            "H8" => RANGE_FROM + 3 * HOUR,
            "D1" => RANGE_FROM + 5 * HOUR,
            _ => RANGE_FROM + 6 * HOUR,
        };
        history_starting_at(timeframe, start)
    };
    let closed = request_between(RANGE_FROM, RANGE_END);
    let first = play_profile(&mut controller, &closed, &history);
    assert_eq!(first.timeframe, "H4");

    // A closed repeat is answered by the cache alone, from the best series.
    let inside = request_between(RANGE_FROM, RANGE_FROM + 20 * HOUR);
    let (timeframe, bars) = controller
        .cached_bars_for(&inside, &all_timeframes())
        .unwrap();
    assert_eq!(timeframe, "H4");
    assert_eq!(
        partial_coverage_start(&bars, RANGE_FROM),
        Some(RANGE_FROM + HOUR)
    );

    // A live repeat only refreshes the best series' newest page.
    let live = request_between(RANGE_FROM, RANGE_END + HOUR);
    let second = play_profile(&mut controller, &live, &history);
    assert_eq!(second.timeframe, "H4");
    assert!(second.retries.is_empty());
    assert_eq!(second.timeframes_asked(), ["H4"]);
    assert_eq!(second.sent.len(), 1);
}

#[test]
fn a_repeat_request_skips_exhausted_timeframes_and_walks_the_one_that_reached() {
    let mut controller = TickCacheController::default();
    let history = |timeframe: &str| {
        let start = if is_minute_timeframe(timeframe) {
            RANGE_FROM + 6 * HOUR
        } else {
            RANGE_FROM - 10 * HOUR
        };
        history_starting_at(timeframe, start)
    };
    let closed = request_between(RANGE_FROM, RANGE_END);
    play_profile(&mut controller, &closed, &history);
    let live = request_between(RANGE_FROM, RANGE_END + HOUR);
    let second = play_profile(&mut controller, &live, &history);
    assert_eq!(second.timeframe, "H1");
    assert!(second.retries.is_empty());
    assert_eq!(second.timeframes_asked(), ["H1"]);
}

#[test]
fn bar_profile_reports_where_partial_coverage_starts_and_tick_profiles_never_do() {
    let state = state_with_symbol();
    let late = vec![
        bar(RANGE_FROM + 5 * MINUTE, 20),
        bar(RANGE_FROM + 6 * MINUTE, 30),
    ];
    let partial = build_bar_profile(&state, &profile_request(), "M1", &late).unwrap();
    assert_eq!(partial.covered_from_ms, Some(RANGE_FROM + 5 * MINUTE));
    let value = serde_json::to_value(&partial).unwrap();
    assert_eq!(value["coveredFromMs"], RANGE_FROM + 5 * MINUTE);

    // A bar that opens before the range start and spans it covers it, even
    // when the next bar opens after a gap (a weekend start).
    let spanning = vec![
        bar(RANGE_FROM - 2 * MINUTE, 10),
        bar(RANGE_FROM + 5 * MINUTE, 20),
    ];
    let full = build_bar_profile(&state, &profile_request(), "M1", &spanning).unwrap();
    assert_eq!(full.covered_from_ms, None);
    assert!(serde_json::to_value(&full).unwrap()["coveredFromMs"].is_null());
}
