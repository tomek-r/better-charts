//! What the chart footprint publishes: the loaded window's complete bars as a read grows, the bars a
//! read stopped inside, and the forming bar after each whole live re-read.
//!
//! The window's event is published after every answered page of the read and once more when the read
//! finishes, so the newest bars reach the chart after the first page instead of after the whole read:
//! while a read is still going its event holds the bars taken whole so far, and the bars it has not
//! reached are simply absent — `incomplete` names only the bars a page actually stopped inside.
//!
//! Every payload names the chart it belongs to and the row width the host resolved, so a chart that
//! switched symbol or timeframe can drop an event that arrived for the previous one. Prices and
//! volumes stay decimal strings on the wire, as trading-core serializes its decimals.

use super::footprint_settings;
use crate::bridge::state::{bridge_emit, BridgeEvents, BridgeState};
use crate::footprint_feed::FootprintFeed;
use rust_decimal::Decimal;
use serde::Serialize;
use std::sync::Arc;
use trading_core::footprint::{bar_footprint, BarFootprint};

/// The event the loaded window's footprint is published on.
pub(crate) const CHART_FOOTPRINT_EVENT: &str = "chart-footprint";
/// The event the forming bar's footprint is published on.
pub(crate) const CHART_FOOTPRINT_FORMING_EVENT: &str = "chart-footprint-forming";

/// The chart the events name: the symbol and timeframe it shows, and the tick size the symbol mirror
/// reports for it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FootprintChart {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
    pub(crate) mintick: Decimal,
}

/// The loaded window's footprint.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartFootprintEvent {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
    pub(crate) ticks_per_row: u32,
    /// The complete bars' footprints, oldest first: every bar a read has taken whole so far, which
    /// while a read is still going is its newest bars only. A bar whose ticks a read did not take
    /// whole is not one of them, and a bar the engine can row no level of (no tick size, no trade) is
    /// left out.
    pub(crate) bars: Vec<BarFootprint>,
    /// The open time of the newest bar a read stopped inside, so the chart can say that ticks before
    /// it are incomplete; `None` when every bar of the window was read whole. A bar a read has not
    /// reached yet is never one of them.
    pub(crate) incomplete_before: Option<i64>,
    /// The open time of every bar a read stopped inside, ascending.
    pub(crate) incomplete: Vec<i64>,
}

/// The forming bar's footprint, after a whole live re-read of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartFootprintFormingEvent {
    pub(crate) symbol: String,
    pub(crate) timeframe: String,
    pub(crate) ticks_per_row: u32,
    /// The forming bar's footprint; `None` while the live reads hold no whole ticks for it, as they do
    /// after a re-read that did not come back whole.
    pub(crate) bar: Option<BarFootprint>,
}

/// The chart the host shows, read out of the stored window and the symbol mirror, both locks released
/// before the caller takes another. `None` while the chart shows no symbol or timeframe, or while the
/// mirror holds no tick size for the symbol: without one a row has no width, so no footprint is
/// published.
pub(crate) fn footprint_chart(state: &BridgeState) -> Option<FootprintChart> {
    let (symbol, timeframe) = {
        let market = state.market.lock().expect("market mutex poisoned");
        (market.symbol.clone()?, market.timeframe.clone()?)
    };
    let mintick = mintick_of(state, &symbol)?;
    Some(FootprintChart {
        symbol,
        timeframe,
        mintick,
    })
}

/// The loaded window's event for what the feed holds, or `None` while the chart footprint is off.
///
/// A window read in flight publishes the bars it has taken whole so far: those are its newest bars,
/// because it reads them first. `incomplete` names only the bars a page stopped inside, so a bar the
/// read has not reached yet is absent rather than reported as incomplete.
pub(crate) fn window_event(
    state: &BridgeState,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
) -> Option<ChartFootprintEvent> {
    let settings = footprint_settings(state)?;
    let chart = chart?;
    let bars: Vec<BarFootprint> = feed
        .complete_bars()
        .filter_map(|(open_ms, ticks)| bar_footprint(open_ms, ticks, chart.mintick, &settings))
        .collect();
    let mut incomplete: Vec<i64> = feed.incomplete_bars().to_vec();
    incomplete.sort_unstable();
    Some(ChartFootprintEvent {
        symbol: chart.symbol.clone(),
        timeframe: chart.timeframe.clone(),
        ticks_per_row: settings.ticks_per_row,
        bars,
        incomplete_before: incomplete.last().copied(),
        incomplete,
    })
}

/// The forming bar's event for what the feed's live reads hold, or `None` while the chart footprint is
/// off.
pub(crate) fn forming_event(
    state: &BridgeState,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
) -> Option<ChartFootprintFormingEvent> {
    let settings = footprint_settings(state)?;
    let chart = chart?;
    let bar = match feed.forming_bar() {
        Some((open_ms, ticks)) => bar_footprint(open_ms, ticks, chart.mintick, &settings),
        None => None,
    };
    Some(ChartFootprintFormingEvent {
        symbol: chart.symbol.clone(),
        timeframe: chart.timeframe.clone(),
        ticks_per_row: settings.ticks_per_row,
        bar,
    })
}

/// Publishes the loaded window's footprint, when the chart footprint is on.
pub(crate) fn publish_window(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
) {
    if let Some(event) = window_event(state, feed, chart) {
        bridge_emit(events, CHART_FOOTPRINT_EVENT, event);
    }
}

/// Publishes the forming bar's footprint, when the chart footprint is on.
pub(crate) fn publish_forming(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
) {
    if let Some(event) = forming_event(state, feed, chart) {
        bridge_emit(events, CHART_FOOTPRINT_FORMING_EVENT, event);
    }
}

/// The tick size the symbol mirror reports for `symbol`, and `None` while it holds no entry for it or
/// names no positive one. The mirror is the only place the symbol's contract comes from, so prices on
/// the wire stay decimal strings.
pub(crate) fn mintick_of(state: &BridgeState, symbol: &str) -> Option<Decimal> {
    let mirror = state
        .symbol_cache
        .lock()
        .expect("symbol cache mutex poisoned");
    let entry = mirror.cache.get(symbol)?;
    let tick_size = entry.tick_size.parse::<Decimal>().ok()?;
    (tick_size > Decimal::ZERO).then_some(tick_size)
}
