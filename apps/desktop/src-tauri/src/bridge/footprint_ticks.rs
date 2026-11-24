//! The trades the chart's bars hold: the chart symbol's raw ticks, read over the indicator ticks
//! route under reserved keys whose answers never reach the frontend (see
//! `docs/protocol/bridge-v1.md`, "Indicator ticks").
//!
//! A footprint counts the trades inside each bar, which the chart's bars do not carry. The host reads
//! the loaded window's ticks newest bar first, groups them by the bar they fall in and keeps every bar
//! it took whole for the chart footprint and for the observer another build may install. The forming
//! bar stays precise the same way: an accepted quote of the chart symbol re-reads the forming bar's
//! ticks to the broker's time, at most once per `FORMING_REREAD_INTERVAL`, under a reserved key of its
//! own, and only from the last millisecond a whole re-read reached, so an hourly or daily bar costs one
//! page a second instead of its whole tick history. A bar is either read whole or not at all: a bar a
//! read stopped inside keeps no ticks and reads as no trades. A new session or another chart symbol
//! drops both reads with the requests that fill them.
//!
//! The chart footprint publishes over the same reads: the loaded window's complete bars when its read
//! finishes and the forming bar after each whole live re-read. It never starts a read of its own, so a
//! chart that asked for no footprint and that no observer needs costs nothing.
//!
//! Everything here expects the caller to hold `session_work`, which every caller already does: the
//! chart load, the quote and the ticks answer all run inside that gate.

use super::{
    log_warn, queue_indicator_ticks, BridgeEvents, BridgeState, IndicatorTicksRequest,
    TickHistorySnapshot,
};
use crate::chart_footprint;
use crate::footprint_feed::{
    footprint_window, forming_bars, FootprintFeed, FormingBars, PageAnswer, PageOutcome, TickPage,
};
use std::sync::{Arc, MutexGuard};
use std::time::Instant;
use trading_core::protocol::MarketCandle;

/// The key the host's window footprint read is routed under. The frontend never asks for it, and an
/// answer under it fills the feed instead of being published as `indicator-ticks`.
pub(crate) const CHART_FOOTPRINT_KEY: &str = "chart-footprint";
/// The key the forming bar's live re-reads are routed under, apart from the window read so that the
/// two never replace each other's answer.
pub(crate) const CHART_FOOTPRINT_LIVE_KEY: &str = "chart-footprint-live";

/// Whether the chart's ticks are read at all: the chart asked for a footprint of its own, or an
/// observer of the same ticks needs them.
pub(crate) fn footprint_needed(state: &BridgeState) -> bool {
    if chart_footprint::is_on(state) {
        return true;
    }
    state
        .footprint_observer
        .get()
        .is_some_and(|observer| observer.needs_ticks())
}

/// Replaces the feed with a read of `candles`' window of `symbol` and queues its first page.
pub(crate) fn start_footprint_read(state: &BridgeState, symbol: &str, candles: &[MarketCandle]) {
    let page_bound = page_bound(state);
    let bars = footprint_window(candles, read_end_ms(state));
    let Some(page) = footprint_feed(state).start(bars, page_bound) else {
        return;
    };
    queue_footprint_page(state, CHART_FOOTPRINT_KEY, symbol, page, page_bound);
}

/// Re-reads the forming bar's ticks after an accepted quote of the chart symbol: to the broker's time,
/// at most once per interval, from the bar's open or from the last millisecond a whole re-read
/// reached, and once more, to its own end, for the bar the chart just left. Queues the page it asks
/// for, if any, and hands the ticks on when a bar stopped being read whole.
pub(crate) fn follow_footprint_quote(state: &BridgeState, events: &Arc<dyn BridgeEvents>) {
    if !footprint_needed(state) {
        return;
    }
    let page_bound = page_bound(state);
    let Some((symbol, forming)) = chart_forming_bars(state) else {
        return;
    };
    // Read out before the feed's lock, so the two are never held together.
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    let step = feed.follow_forming_bar(forming, Instant::now(), page_bound);
    if step.ticks_dropped {
        notify_observer(state, &feed);
        // The forming bar's ticks left the readable set, so the chart hears that it has no footprint
        // until a whole re-read lands.
        chart_footprint::publish_forming(state, events, &feed, chart.as_ref());
    }
    drop(feed);
    let Some(page) = step.page else {
        return;
    };
    queue_footprint_page(state, CHART_FOOTPRINT_LIVE_KEY, &symbol, page, page_bound);
}

/// Folds one answered page of the host's own reads in and answers whether `key` is one of them; a key
/// that is not feeds the frontend's `indicator-ticks` event instead.
pub(crate) fn accept_footprint_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    key: &str,
    snapshot: &TickHistorySnapshot,
) -> bool {
    if key == CHART_FOOTPRINT_KEY {
        accept_window_page(state, events, snapshot);
        return true;
    }
    if key == CHART_FOOTPRINT_LIVE_KEY {
        accept_live_page(state, events, snapshot);
        return true;
    }
    false
}

/// Ends one of the host's own reads where it stands, because the EA could not answer it, and answers
/// whether `key` is one of them. The bars a read took whole keep their footprints; a bar it stopped
/// inside reads as no trades, and the chart footprint publishes the window again so the chart says so.
pub(crate) fn abandon_footprint_read(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    key: &str,
) -> bool {
    let live = key == CHART_FOOTPRINT_LIVE_KEY;
    if !live && key != CHART_FOOTPRINT_KEY {
        return false;
    }
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    if live {
        // A live read that ends here can leave the forming bar without whole ticks, which whoever
        // reads them hears at once.
        if feed.abandon_live_read() {
            notify_observer(state, &feed);
            chart_footprint::publish_forming(state, events, &feed, chart.as_ref());
        }
        return true;
    }
    feed.finish_read();
    notify_observer(state, &feed);
    chart_footprint::publish_window(state, events, &feed, chart.as_ref());
    true
}

/// Forgets both reads: another session or chart symbol computes from here.
pub(crate) fn drop_footprint_feed(state: &BridgeState) {
    footprint_feed(state).clear();
}

/// Folds one answered page of the window read in, asks for the next, and hands the ticks on once the
/// window is covered, the budget is spent or a bar stopped the read inside itself.
fn accept_window_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    snapshot: &TickHistorySnapshot,
) {
    let page_bound = page_bound(state);
    let symbol = snapshot.symbol.as_str();
    // Read out before the feed's lock, so the two are never held together.
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    match feed.accept_page(answer(snapshot), page_bound) {
        PageOutcome::Next(page) => {
            drop(feed);
            queue_footprint_page(state, CHART_FOOTPRINT_KEY, symbol, page, page_bound);
        }
        PageOutcome::Finished => {
            notify_observer(state, &feed);
            chart_footprint::publish_window(state, events, &feed, chart.as_ref());
        }
        PageOutcome::Idle => {}
    }
}

/// Folds one answered page of the forming bar's live read in; a whole re-read replaces the forming
/// bar's ticks, which the chart footprint then publishes. A bar the chart left behind lands complete
/// here, so the window is published again when the count of complete bars grew.
fn accept_live_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    snapshot: &TickHistorySnapshot,
) {
    let page_bound = page_bound(state);
    let symbol = snapshot.symbol.as_str();
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    let complete_before = feed.complete_bar_count();
    match feed.accept_live_page(answer(snapshot), page_bound) {
        PageOutcome::Next(page) => {
            drop(feed);
            queue_footprint_page(state, CHART_FOOTPRINT_LIVE_KEY, symbol, page, page_bound);
        }
        PageOutcome::Finished => {
            notify_observer(state, &feed);
            chart_footprint::publish_forming(state, events, &feed, chart.as_ref());
            if feed.complete_bar_count() > complete_before {
                chart_footprint::publish_window(state, events, &feed, chart.as_ref());
            }
        }
        PageOutcome::Idle => {}
    }
}

/// The answered page as the read folds it in.
fn answer(snapshot: &TickHistorySnapshot) -> PageAnswer<'_> {
    PageAnswer {
        ticks: &snapshot.ticks,
        complete: snapshot.complete,
    }
}

/// Hands every tick read whole so far to the observer another build installed, if any: this build
/// publishes the chart footprint itself, so without one nothing else consumes them.
fn notify_observer(state: &BridgeState, feed: &FootprintFeed) {
    if let Some(observer) = state.footprint_observer.get() {
        observer.ticks_changed(&feed.complete_ticks());
    }
}

/// The feed of the chart symbol's ticks: the single place naming the poisoned-mutex expectation.
fn footprint_feed(state: &BridgeState) -> MutexGuard<'_, FootprintFeed> {
    state
        .footprint_feed
        .lock()
        .expect("footprint feed mutex poisoned")
}

/// Queues one page of a reserved read on the indicator ticks route.
fn queue_footprint_page(
    state: &BridgeState,
    key: &str,
    symbol: &str,
    page: TickPage,
    page_bound: u32,
) {
    let request = IndicatorTicksRequest::build(
        key.to_owned(),
        symbol.to_owned(),
        page.from_ms,
        page.to_ms,
        page.max_ticks,
        page_bound,
    );
    match request {
        Ok(request) => queue_indicator_ticks(state, request),
        Err(error) => log_warn(&format!(
            "footprint ticks {symbol} {}..{} were not asked for: {error}",
            page.from_ms, page.to_ms
        )),
    }
}

/// The chart's forming bar, the bar before it and the symbol they belong to, as the stored window
/// holds them.
fn chart_forming_bars(state: &BridgeState) -> Option<(String, FormingBars)> {
    let read_end_ms = read_end_ms(state);
    let market = state.market.lock().expect("market mutex poisoned");
    let symbol = market.symbol.clone()?;
    let forming = forming_bars(&market.candles, read_end_ms)?;
    Some((symbol, forming))
}

/// How far past the newest bar a read reaches: the broker's own clock, so the ticks of the bar in
/// progress are covered before its end comes. Zero while no heartbeat has reported one, and the newest
/// bar's own span then ends the read.
fn read_end_ms(state: &BridgeState) -> i64 {
    let status = state.status.lock().expect("bridge status mutex poisoned");
    status
        .market_session
        .as_ref()
        .map_or(0, |session| session.server_time_ms)
}

/// The largest tick page the connected EA accepts.
fn page_bound(state: &BridgeState) -> u32 {
    state
        .transfer_limits
        .lock()
        .expect("transfer limits mutex poisoned")
        .max_ticks_per_page
}
