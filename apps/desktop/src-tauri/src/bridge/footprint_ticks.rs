//! The trades the chart's bars hold: the chart symbol's ticks, read over the indicator ticks route
//! under reserved keys whose answers never reach the frontend (see `docs/protocol/bridge-v1.md`,
//! "Indicator ticks").
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
//! Once the handshake negotiated `tick_footprint_counts`, the same two reads ask for MT5's counted
//! pages instead of the raw ticks: one request per bar, or per rest of a bar, whose per-price totals
//! become the bar's ticks. A bar the chart leaves keeps the footprint its counted levels already name
//! and is finished from the millisecond they reached, so the chart never loses it while the rest of
//! the bar lands, and the following forming bar's first read goes out the moment that read does. A
//! peer without the capability keeps the raw path above unchanged; the keys, the events, the timing
//! lines and the observer hear the same thing either way.
//!
//! The chart footprint publishes over the same reads: the loaded window's complete bars after each
//! answered page — so the newest bars reach the chart after the first page instead of after the whole
//! read — and again when the read finishes, and the forming bar after each whole live re-read, with
//! the window again when the bar the chart left keeps its counted footprint or lands whole. It never
//! starts a read of its own, so a chart that asked for no footprint and that no observer needs costs
//! nothing.
//!
//! Every answered window page and every finished window read prints one `[bridge] INFO` timing line
//! (under `MT5_BRIDGE_PROFILE_LOG=1`, like the tick profile's lines): the bars and ticks the page
//! covered and the milliseconds it took, so a slow history read can be measured instead of guessed.
//!
//! Everything here expects the caller to hold `session_work`, which every caller already does: the
//! chart load, the quote and the ticks answer all run inside that gate.

use super::{
    log_info, log_warn, queue_indicator_ticks, BridgeEvents, BridgeState, IndicatorTicksRequest,
    TickHistorySnapshot,
};
use crate::chart_footprint;
use crate::chart_footprint::events::FootprintChart;
use crate::footprint_feed::{
    footprint_window, forming_bars, BarSpan, CountsOutcome, CountsPage, FootprintFeed, FormingBars,
    PageAnswer, PageOutcome, ReadTiming, TickPage,
};
use std::sync::{Arc, MutexGuard};
use std::time::Instant;
use trading_core::protocol::{MarketCandle, MarketTick, TickFootprintHistorySnapshot};
use trading_core::volume_profile::TICK_FLAG_BID;

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

/// Whether the EA answers footprint reads with its counted pages: the capability both peers
/// negotiated in the handshake.
fn reads_footprint_counts(state: &BridgeState) -> bool {
    *state
        .tick_footprint_counts
        .lock()
        .expect("footprint capability mutex poisoned")
}

/// Replaces the feed with a read of `candles`' window of `symbol` and queues its first page.
pub(crate) fn start_footprint_read(state: &BridgeState, symbol: &str, candles: &[MarketCandle]) {
    let bars = footprint_window(candles, read_end_ms(state));
    if reads_footprint_counts(state) {
        start_counts_read(state, symbol, bars);
    } else {
        start_ticks_read(state, symbol, bars);
    }
}

/// Queues the first page of the raw window read.
fn start_ticks_read(state: &BridgeState, symbol: &str, bars: Vec<BarSpan>) {
    let page_bound = page_bound(state);
    let Some(page) = footprint_feed(state).start(bars, page_bound) else {
        return;
    };
    queue_footprint_page(state, CHART_FOOTPRINT_KEY, symbol, page, page_bound);
}

/// Queues the first page of the counted window read.
fn start_counts_read(state: &BridgeState, symbol: &str, bars: Vec<BarSpan>) {
    let Some(page) = footprint_feed(state).start_counts(bars) else {
        return;
    };
    queue_counts_page(state, CHART_FOOTPRINT_KEY, symbol, page);
}

/// Re-reads the forming bar's ticks after an accepted quote of the chart symbol: to the broker's time,
/// at most once per interval, from the bar's open or from the last millisecond a whole re-read
/// reached, and once more, to its own end, for the bar the chart just left. Queues the page it asks
/// for, if any, and hands the ticks on when a bar stopped being read whole.
pub(crate) fn follow_footprint_quote(state: &BridgeState, events: &Arc<dyn BridgeEvents>) {
    if !footprint_needed(state) {
        return;
    }
    let counts = reads_footprint_counts(state);
    let Some((symbol, forming)) = chart_forming_bars(state) else {
        return;
    };
    // Read out before the feed's lock, so the two are never held together.
    let chart = chart_footprint::footprint_chart(state);
    if counts {
        follow_counts_quote(state, events, &symbol, forming, chart.as_ref());
    } else {
        follow_ticks_quote(state, events, &symbol, forming, chart.as_ref());
    }
}

/// Queues the page a raw re-read of the forming bar asks for.
fn follow_ticks_quote(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    symbol: &str,
    forming: FormingBars,
    chart: Option<&FootprintChart>,
) {
    let page_bound = page_bound(state);
    let step = {
        let mut feed = footprint_feed(state);
        let step = feed.follow_forming_bar(forming, Instant::now(), page_bound);
        if step.ticks_dropped {
            publish_forming_ticks(state, events, &feed, chart, false);
        }
        step
    };
    let Some(page) = step.page else {
        return;
    };
    queue_footprint_page(state, CHART_FOOTPRINT_LIVE_KEY, symbol, page, page_bound);
}

/// Queues the page a counted re-read of the forming bar asks for.
fn follow_counts_quote(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    symbol: &str,
    forming: FormingBars,
    chart: Option<&FootprintChart>,
) {
    let step = {
        let mut feed = footprint_feed(state);
        let step = feed.follow_forming_bar_counts(forming, Instant::now());
        if step.ticks_dropped {
            publish_forming_ticks(state, events, &feed, chart, step.window_changed);
        }
        step
    };
    let Some(page) = step.page else {
        return;
    };
    queue_counts_page(state, CHART_FOOTPRINT_LIVE_KEY, symbol, page);
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

/// Folds one answered counted page of the host's own reads in and answers whether `key` is one of
/// them; a key that is not names no read the host asked for.
pub(crate) fn accept_footprint_counts_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    key: &str,
    snapshot: &TickFootprintHistorySnapshot,
) -> bool {
    if key == CHART_FOOTPRINT_KEY {
        accept_counts_window_page(state, events, snapshot);
        return true;
    }
    if key == CHART_FOOTPRINT_LIVE_KEY {
        accept_counts_live_page(state, events, snapshot);
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
    let counts = reads_footprint_counts(state);
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    if live {
        // A live read that ends here can leave the forming bar without whole ticks, which whoever
        // reads them hears at once; a closing read that ends here drops the footprint the window held
        // provisionally for the bar the chart left, which it must hear too.
        let closing = counts && feed.closing_counts_live_read();
        let dropped = if counts {
            feed.abandon_counts_live_read()
        } else {
            feed.abandon_live_read()
        };
        if dropped {
            publish_forming_ticks(state, events, &feed, chart.as_ref(), closing);
        }
        return true;
    }
    if counts {
        feed.finish_counts_read();
    } else {
        feed.finish_read();
    }
    publish_window_read(state, events, &feed, chart.as_ref(), true);
    true
}

/// Forgets both reads: another session or chart symbol computes from here.
pub(crate) fn drop_footprint_feed(state: &BridgeState) {
    footprint_feed(state).clear();
}

/// Hands the bars the window read has taken whole so far to the chart footprint — and the whole set to
/// the observer once the read is over — whichever kind of page filled them.
fn publish_window_read(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
    finished: bool,
) {
    if finished {
        notify_observer(state, feed);
    }
    chart_footprint::publish_window(state, events, feed, chart);
}

/// Hands the forming bar's ticks to the observer and to the chart footprint, and the window again when
/// the bars it publishes changed with them: the bar the chart left landed whole, or it kept the
/// footprint its counted levels already had. Either kind of page can fill them.
fn publish_forming_ticks(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    feed: &FootprintFeed,
    chart: Option<&FootprintChart>,
    window_changed: bool,
) {
    notify_observer(state, feed);
    chart_footprint::publish_forming(state, events, feed, chart);
    if window_changed {
        chart_footprint::publish_window(state, events, feed, chart);
    }
}

/// Folds one answered page of the window read in, asks for the next, and hands the ticks on once the
/// window is covered, the budget is spent or a bar stopped the read inside itself. Each answered page
/// publishes the bars the read has taken whole so far, so the chart shows its newest bars as soon as
/// the first page lands; a read still going names no bar it has not reached as incomplete.
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
    let timing = feed.read_timing();
    let mt5_tick_volume = feed.candle_tick_volume(snapshot.from_ms, snapshot.to_ms);
    match feed.accept_page(answer(snapshot), page_bound) {
        PageOutcome::Next(page) => {
            log_window_page(symbol, &timing, snapshot, mt5_tick_volume);
            publish_window_read(state, events, &feed, chart.as_ref(), false);
            drop(feed);
            queue_footprint_page(state, CHART_FOOTPRINT_KEY, symbol, page, page_bound);
        }
        PageOutcome::Finished => {
            log_window_page(symbol, &timing, snapshot, mt5_tick_volume);
            log_finished_window(symbol, &timing, snapshot, feed.complete_bar_count());
            publish_window_read(state, events, &feed, chart.as_ref(), true);
        }
        PageOutcome::Idle => {}
    }
}

/// Folds one answered counted page of the window read in, asks for the next, and hands the ticks on
/// exactly as the raw pages do: every page publishes the bars the read has taken whole so far.
fn accept_counts_window_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    snapshot: &TickFootprintHistorySnapshot,
) {
    let symbol = snapshot.symbol.as_str();
    // Read out before the feed's lock, so the two are never held together.
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    let timing = feed.read_timing();
    match feed.accept_counts_page(snapshot) {
        CountsOutcome::Next(page) => {
            log_counts_page(symbol, &timing, snapshot);
            publish_window_read(state, events, &feed, chart.as_ref(), false);
            drop(feed);
            queue_counts_page(state, CHART_FOOTPRINT_KEY, symbol, page);
        }
        CountsOutcome::Finished => {
            log_counts_page(symbol, &timing, snapshot);
            publish_window_read(state, events, &feed, chart.as_ref(), true);
        }
        CountsOutcome::Idle => {}
    }
}

/// Logs one answered window page: the bars it covered, the ticks it brought, whether it held its whole
/// range, the milliseconds it took the EA to answer it, how many of its ticks report MT5's bid flag and
/// how many ticks MT5 counted in the bars the range covers, so the footprint's tick count can be
/// compared with MT5's Tick Volume.
fn log_window_page(
    symbol: &str,
    timing: &ReadTiming,
    snapshot: &TickHistorySnapshot,
    mt5_tick_volume: u64,
) {
    log_info(&format!(
        "footprint ticks {symbol} page {}..{} bars={} ticks={} complete={} waited_ms={} bid_changes={} mt5_tick_volume={}",
        snapshot.from_ms,
        snapshot.to_ms,
        timing.page_bars,
        snapshot.ticks.len(),
        snapshot.complete,
        elapsed_ms(timing.page_queued),
        bid_changes(&snapshot.ticks),
        mt5_tick_volume,
    ));
}

/// Logs one answered counted page: the range it counted, the records it read behind the counted
/// trades, whether it reached the range's end and the milliseconds it took the EA to answer it.
fn log_counts_page(symbol: &str, timing: &ReadTiming, snapshot: &TickFootprintHistorySnapshot) {
    log_info(&format!(
        "footprint counts {symbol} page {}..{} bars={} ticks={} trades={} complete={} waited_ms={}",
        snapshot.from_ms,
        snapshot.to_ms,
        timing.page_bars,
        snapshot.loaded_ticks,
        snapshot.trade_ticks,
        snapshot.complete,
        elapsed_ms(timing.page_queued),
    ));
}

/// How many of `ticks` report MT5's bid flag (flag `2`, the bid changed).
fn bid_changes(ticks: &[MarketTick]) -> usize {
    ticks
        .iter()
        .filter(|tick| tick.flags & TICK_FLAG_BID != 0)
        .count()
}

/// Logs the finished window read: the bars it took whole, the ticks it read and the milliseconds it
/// took from the page that started it.
fn log_finished_window(
    symbol: &str,
    timing: &ReadTiming,
    snapshot: &TickHistorySnapshot,
    bars: usize,
) {
    log_info(&format!(
        "footprint ticks {symbol} read finished bars={bars} ticks={} pages={} elapsed_ms={}",
        timing.ticks + snapshot.ticks.len(),
        timing.pages + 1,
        elapsed_ms(timing.started),
    ));
}

/// The milliseconds since `then`, and `0` when the feed timed nothing.
fn elapsed_ms(then: Option<Instant>) -> u64 {
    then.map_or(0, |then| {
        u64::try_from(then.elapsed().as_millis()).unwrap_or(u64::MAX)
    })
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
            let landed = feed.complete_bar_count() > complete_before;
            publish_forming_ticks(state, events, &feed, chart.as_ref(), landed);
        }
        PageOutcome::Idle => {}
    }
}

/// Folds one answered counted page of the forming bar's read in, exactly as the raw live pages do: a
/// closing read that lands hands the window its finished bar and starts the following forming bar's
/// first page, which is queued at once under the live key.
fn accept_counts_live_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    snapshot: &TickFootprintHistorySnapshot,
) {
    let symbol = snapshot.symbol.as_str();
    let chart = chart_footprint::footprint_chart(state);
    let mut feed = footprint_feed(state);
    let closing = feed.closing_counts_live_read();
    let complete_before = feed.complete_bar_count();
    match feed.accept_counts_live_page(snapshot) {
        CountsOutcome::Next(page) => {
            // A closing read leaves no complete read to count: it replaced the footprint the window
            // held provisionally, so the window hears its finished bar from the page it started.
            if closing && !feed.closing_counts_live_read() {
                publish_forming_ticks(state, events, &feed, chart.as_ref(), true);
            }
            drop(feed);
            queue_counts_page(state, CHART_FOOTPRINT_LIVE_KEY, symbol, page);
        }
        CountsOutcome::Finished => {
            let landed = closing || feed.complete_bar_count() > complete_before;
            publish_forming_ticks(state, events, &feed, chart.as_ref(), landed);
        }
        CountsOutcome::Idle => {}
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

/// Queues one counted page of a reserved read on the indicator ticks route.
fn queue_counts_page(state: &BridgeState, key: &str, symbol: &str, page: CountsPage) {
    let page_bound = page_bound(state);
    let request = IndicatorTicksRequest::build_footprint_counts(
        key.to_owned(),
        page.request(symbol, page_bound),
        page_bound,
    );
    match request {
        Ok(request) => queue_indicator_ticks(state, request),
        Err(error) => log_warn(&format!(
            "footprint counts {symbol} bar {} {}..{} were not asked for: {error}",
            page.open_ms, page.from_ms, page.to_ms
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
