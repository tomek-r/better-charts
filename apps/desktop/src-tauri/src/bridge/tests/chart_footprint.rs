//! The chart footprint the host publishes for the chart's own bars: the loaded window's complete
//! bars, the bars a read stopped inside, the forming bar after a whole re-read — and nothing at all
//! while the chart footprint is off.
use super::common::{broker_symbol, RecordedEvents};
use super::*;
use crate::chart_footprint;
use crate::chart_footprint::events::{CHART_FOOTPRINT_EVENT, CHART_FOOTPRINT_FORMING_EVENT};
use crate::chart_footprint::{ChartFootprintRequest, ChartFootprintRowSize};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::time::Instant;
use trading_core::footprint::{FootprintTick, TICK_FLAG_BUY, TICK_FLAG_SELL};
use trading_core::protocol::{
    FootprintBarCounts, FootprintCarry, FootprintLevel, FootprintSide, MarketTick,
    TickFootprintHistoryRequest, TickFootprintHistorySnapshot,
};

const SESSION: &str = "session-1";
const SYMBOL: &str = "NAS100";
const TIMEFRAME: &str = "M1";
const MINUTE_MS: i64 = 60_000;
/// The millisecond halfway through a bar: where a page of these tests stops inside a bar.
const HALF_MINUTE_MS: i64 = MINUTE_MS / 2;
/// The row width these tests ask for: ten tenths of a point, so one row spans one point.
const TICKS_PER_ROW: u32 = 10;

/// The decimal `value` names.
fn dec(value: &str) -> Decimal {
    value.parse().expect("a decimal")
}

/// A bar whose every price is `close`, with one tick counted in it.
fn candle(time_ms: i64, close: &str) -> MarketCandle {
    candle_with_ticks(time_ms, close, 1)
}

/// A bar whose every price is `close`, with `tick_volume` ticks counted in it, as MT5 reports them:
/// the host sizes a window read's pages from them.
fn candle_with_ticks(time_ms: i64, close: &str, tick_volume: u64) -> MarketCandle {
    MarketCandle {
        time_ms,
        open: close.to_owned(),
        high: close.to_owned(),
        low: close.to_owned(),
        close: close.to_owned(),
        tick_volume,
        spread: 0,
        real_volume: 0,
    }
}

/// The window the chart loads over these tests' symbols.
fn snapshot(window: &[MarketCandle]) -> MarketSnapshot {
    MarketSnapshot {
        symbol: Some(SYMBOL.into()),
        timeframe: Some(TIMEFRAME.into()),
        complete: true,
        candles: window.to_vec(),
    }
}

/// A chart of `window` on the mirrored chart symbol, with a live session, so only a consumer of the
/// ticks can start a read.
fn chart_state(window: &[MarketCandle]) -> (BridgeState, Arc<RecordedEvents>) {
    let recorded = Arc::new(RecordedEvents::default());
    let state = BridgeState::with_symbol_cache_path(None);
    *state.current_session.lock().unwrap() = Some(SESSION.into());
    // The fixture mirrors a one-digit contract, so a tick is a tenth of a point.
    state.remember_symbols([broker_symbol(SYMBOL)]);
    *state.market.lock().unwrap() = snapshot(window);
    (state, recorded)
}

/// A request for rows of `ticks_per_row`, with the engine's default value area.
fn manual_request(ticks_per_row: u32) -> ChartFootprintRequest {
    ChartFootprintRequest {
        row_size: ChartFootprintRowSize::Manual { ticks_per_row },
        va_percent: dec("70"),
        imbalance_percent: dec("300"),
    }
}

/// Turns the chart footprint on with the row width these tests ask for.
fn enable(state: &BridgeState) {
    let request = manual_request(TICKS_PER_ROW);
    chart_footprint::apply(state, Some(request)).expect("a valid request");
}

/// One tick the EA writes: the price it traded at, the volume it moved and the side its flags name.
fn tick(time_ms: i64, price: &str, volume: &str, flags: u32) -> MarketTick {
    MarketTick {
        time_ms,
        bid: price.into(),
        ask: price.into(),
        last: price.into(),
        volume: 1,
        volume_real: volume.into(),
        flags,
    }
}

/// One answered page of a reserved read.
fn page(from_ms: i64, to_ms: i64, complete: bool, ticks: &[MarketTick]) -> TickHistorySnapshot {
    TickHistorySnapshot {
        request_id: "rust-indicator-ticks-1".into(),
        symbol: SYMBOL.into(),
        from_ms,
        to_ms,
        tick_size: "0.1".into(),
        complete,
        ticks: ticks.to_vec(),
    }
}

/// One accepted quote of the chart symbol; the host re-reads the forming bar's ticks from it.
fn chart_quote(time_ms: i64) -> QuoteUpdate {
    QuoteUpdate {
        symbol: SYMBOL.into(),
        time_ms,
        bid: "100".into(),
        ask: "100".into(),
        last: "100".into(),
        volume: 1,
        volume_real: "1".into(),
        flags: TICK_FLAG_BUY,
    }
}

/// Answers the window's read page by page, as the EA would: every page the read queued is claimed from
/// the ticks route and answered with one buy tick at the open of each bar it asked for, until the read
/// asks for nothing more.
fn read_window(state: &BridgeState, events: &Arc<dyn BridgeEvents>, window: &[MarketCandle]) {
    let mut pages = 0;
    while let Some(claimed) = claim_next_tick_request(state, &state.next_request_id, Instant::now())
    {
        pages += 1;
        assert!(
            pages <= window.len(),
            "a window read asks for no more pages than its bars"
        );
        let request = ticks_slots(state)
            .take_awaited(&claimed.request_id)
            .expect("the claimed page is awaited");
        assert_eq!(request.key, CHART_FOOTPRINT_KEY);
        let ticks = ticks_in(window, request.page.from_ms, request.page.to_ms);
        let answered = page(request.page.from_ms, request.page.to_ms, true, &ticks);
        assert!(accept_footprint_page(
            state,
            events,
            CHART_FOOTPRINT_KEY,
            &answered
        ));
    }
}

/// One buy tick at the open of each bar of `window` the page of `from_ms..to_ms` asked for.
fn ticks_in(window: &[MarketCandle], from_ms: i64, to_ms: i64) -> Vec<MarketTick> {
    window
        .iter()
        .filter(|bar| (from_ms..to_ms).contains(&bar.time_ms))
        .map(|bar| tick(bar.time_ms, "100", "2", TICK_FLAG_BUY))
        .collect()
}

/// The opening times of the bars a `chart-footprint` event carries, oldest first.
fn bar_opens(event: &serde_json::Value) -> Vec<i64> {
    event["bars"]
        .as_array()
        .expect("the bars are a list")
        .iter()
        .map(|bar| bar["openMs"].as_i64().expect("a bar names its open"))
        .collect()
}

/// An observer that keeps the ticks it was last handed.
#[derive(Default)]
struct RecordingObserver {
    ticks: Mutex<Option<BTreeMap<i64, Vec<FootprintTick>>>>,
}

impl RecordingObserver {
    /// The opening times of the bars the last call carried, ascending.
    fn bars(&self) -> Vec<i64> {
        self.ticks
            .lock()
            .expect("observer mutex poisoned")
            .as_ref()
            .map(|ticks| ticks.keys().copied().collect())
            .unwrap_or_default()
    }
}

impl FootprintObserver for RecordingObserver {
    fn needs_ticks(&self) -> bool {
        true
    }

    fn ticks_changed(&self, ticks: &BTreeMap<i64, Vec<FootprintTick>>) {
        *self.ticks.lock().expect("observer mutex poisoned") = Some(ticks.clone());
    }
}

#[test]
fn enabling_the_chart_footprint_reads_the_window_it_shows() {
    let (state, _recorded) = chart_state(&[candle(0, "100"), candle(MINUTE_MS, "100")]);

    enable(&state);

    let queued = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the window's own read is queued");
    assert_eq!(queued.request.key, CHART_FOOTPRINT_KEY);
}

#[test]
fn a_finished_window_read_publishes_its_complete_bars_oldest_first() {
    let window = [
        candle(0, "100"),
        candle(MINUTE_MS, "100"),
        candle(2 * MINUTE_MS, "100"),
    ];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    enable(&state);

    read_window(&state, &events, &window);

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the window read publishes its bars");
    assert_eq!(event["symbol"], SYMBOL);
    assert_eq!(event["timeframe"], TIMEFRAME);
    assert_eq!(event["ticksPerRow"], TICKS_PER_ROW);
    assert_eq!(event["incompleteBefore"], serde_json::Value::Null);
    assert!(event["incomplete"]
        .as_array()
        .expect("the incomplete bars are a list")
        .is_empty());
    let bars = event["bars"].as_array().expect("the bars are a list");
    assert_eq!(bars.len(), 3, "one footprint per complete bar");
    assert_eq!(bars[0]["openMs"], 0);
    assert_eq!(bars[1]["openMs"], MINUTE_MS);
    assert_eq!(bars[2]["openMs"], 2 * MINUTE_MS, "oldest first");
    // Ten tenths of a point per row: price 100 sits at tick 1000, which is row 100, and the page's
    // two lots bought are its buy volume, which the wire keeps a decimal string.
    assert_eq!(bars[0]["rows"][0]["row"], 100);
    assert_eq!(bars[0]["rows"][0]["buyVolume"], "2");
    assert_eq!(bars[0]["rows"][0]["sellVolume"], "0");
    assert_eq!(bars[0]["volume"], "real");
}

#[test]
fn a_bar_the_read_stopped_inside_is_published_apart_and_kept_out_of_the_bars() {
    // Two bars whose candles counted two ticks each and a two-tick page: the read covers one bar at a
    // time, so its first page is the newest bar alone.
    let window = [
        candle_with_ticks(0, "100", 2),
        candle_with_ticks(MINUTE_MS, "100", 2),
    ];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 2;
    enable(&state);

    // The newest bar's page holds more ticks in its first millisecond than one page carries, so the
    // read stops inside that bar and keeps none of its ticks.
    let stopped = page(
        MINUTE_MS,
        MINUTE_MS + 1,
        false,
        &[
            tick(MINUTE_MS, "100", "1", TICK_FLAG_BUY),
            tick(MINUTE_MS, "100", "1", TICK_FLAG_SELL),
        ],
    );
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &stopped
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the read finished inside the newest bar");
    assert!(
        event["bars"]
            .as_array()
            .expect("the bars are a list")
            .is_empty(),
        "a bar no read took whole has no footprint"
    );
    assert_eq!(event["incompleteBefore"], MINUTE_MS);
    assert_eq!(event["incomplete"], serde_json::json!([MINUTE_MS]));
}

#[test]
fn a_window_read_publishes_the_newest_bars_after_its_first_page() {
    // Two bars whose candles counted two ticks each and a two-tick page: the read asks for the newest
    // bar first and for the bar under it once that one is whole.
    let window = [
        candle_with_ticks(0, "100", 2),
        candle_with_ticks(MINUTE_MS, "100", 2),
    ];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 2;
    enable(&state);

    let first = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the newest bar's page");
    assert_eq!(first.request.key, CHART_FOOTPRINT_KEY);
    let answered = page(
        MINUTE_MS,
        MINUTE_MS + 1,
        true,
        &[tick(MINUTE_MS, "100", "2", TICK_FLAG_BUY)],
    );
    assert!(ticks_slots(&state)
        .take_awaited(&first.request_id)
        .is_some());
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let first_event = published
        .last()
        .expect("the first page publishes the bar it read");
    assert_eq!(
        bar_opens(first_event),
        vec![MINUTE_MS],
        "the bars the read has taken whole so far are its newest one"
    );
    assert_eq!(
        first_event["incompleteBefore"],
        serde_json::Value::Null,
        "the bar the read has not reached yet is not reported incomplete"
    );
    assert!(first_event["incomplete"]
        .as_array()
        .expect("the incomplete bars are a list")
        .is_empty());

    let second = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the bar under the newest one");
    assert_eq!(second.request.key, CHART_FOOTPRINT_KEY);
    let answered = page(0, MINUTE_MS, true, &[tick(0, "100", "2", TICK_FLAG_BUY)]);
    assert!(ticks_slots(&state)
        .take_awaited(&second.request_id)
        .is_some());
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let finished = published
        .last()
        .expect("the finished read publishes both bars");
    assert_eq!(bar_opens(finished), vec![0, MINUTE_MS]);
    assert_eq!(finished["incompleteBefore"], serde_json::Value::Null);
}

#[test]
fn a_whole_reread_of_the_forming_bar_publishes_its_footprint() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    enable(&state);
    read_window(&state, &events, &window);

    // The quote makes the host re-read the forming bar from its open; the bar's ticks from the window
    // read stop before the broker's time, so the chart first hears that it has no footprint yet.
    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    let live = page(
        MINUTE_MS,
        MINUTE_MS + 1,
        true,
        &[
            tick(MINUTE_MS, "100", "3", TICK_FLAG_BUY),
            tick(MINUTE_MS, "100", "2", TICK_FLAG_SELL),
        ],
    );
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY,
        &live
    ));

    let forming = recorded.named(CHART_FOOTPRINT_FORMING_EVENT);
    assert!(
        forming[0]["bar"].is_null(),
        "the window's read of the forming bar stops short of the broker's time"
    );
    let event = forming.last().expect("the whole re-read publishes the bar");
    assert_eq!(event["symbol"], SYMBOL);
    assert_eq!(event["timeframe"], TIMEFRAME);
    assert_eq!(event["ticksPerRow"], TICKS_PER_ROW);
    assert_eq!(event["bar"]["openMs"], MINUTE_MS);
    assert_eq!(event["bar"]["buyVolume"], "3");
    assert_eq!(event["bar"]["sellVolume"], "2");
    assert_eq!(event["bar"]["volume"], "real");
}

#[test]
fn a_closed_bar_landing_whole_publishes_the_window_again() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    enable(&state);
    read_window(&state, &events, &window);
    let windows_before = recorded.named(CHART_FOOTPRINT_EVENT).len();

    // The forming bar is read whole once, then the chart gains a bar and reads the one it left behind
    // to that bar's own end.
    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    let forming = page(
        MINUTE_MS,
        MINUTE_MS + 1,
        true,
        &[tick(MINUTE_MS, "100", "2", TICK_FLAG_BUY)],
    );
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY,
        &forming
    ));
    let newer = BarUpdate {
        symbol: SYMBOL.into(),
        timeframe: TIMEFRAME.into(),
        candle: candle(2 * MINUTE_MS, "101"),
    };
    assert_eq!(
        accept_bar_update(&state, SESSION, &newer),
        BarUpdateAcceptance::Applied
    );
    assert!(accept_quote(&events, &state, SESSION, chart_quote(2 * MINUTE_MS)).is_some());
    let closing = page(
        MINUTE_MS,
        2 * MINUTE_MS,
        true,
        &[tick(MINUTE_MS + 30_000, "100", "4", TICK_FLAG_BUY)],
    );
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY,
        &closing
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    assert!(
        published.len() > windows_before,
        "the closed bar landing whole publishes the window again"
    );
    let event = published.last().expect("the window gained a complete bar");
    assert_eq!(
        bar_opens(event),
        vec![0, MINUTE_MS],
        "both closed bars are complete"
    );
    assert!(event["incomplete"]
        .as_array()
        .expect("the incomplete bars are a list")
        .is_empty());
}

#[test]
fn nothing_is_published_while_the_chart_footprint_is_off() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    enable(&state);
    chart_footprint::apply(&state, None).expect("turning it off never fails");

    read_window(&state, &events, &window);

    assert_eq!(
        state.footprint_feed.lock().unwrap().complete_bar_count(),
        2,
        "the read itself still takes every bar whole"
    );
    assert!(recorded.named(CHART_FOOTPRINT_EVENT).is_empty());
    assert!(recorded.named(CHART_FOOTPRINT_FORMING_EVENT).is_empty());
}

#[test]
fn an_observer_keeps_the_ticks_coming_while_the_chart_footprint_is_off() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    let observer = Arc::new(RecordingObserver::default());
    assert!(state.footprint_observer.set(observer.clone()).is_ok());

    // A chart load replaces the feed; the read starts because the observer needs the ticks.
    publish_market(&events, &state, SESSION, snapshot(&window));

    read_window(&state, &events, &window);

    assert_eq!(observer.bars(), vec![0, MINUTE_MS]);
    assert!(recorded.named(CHART_FOOTPRINT_EVENT).is_empty());
}

#[test]
fn a_live_reread_waits_for_the_window_page_holding_the_one_tick_slot() {
    // A single-bar window reads in one page, so the live re-read is the only request queued behind it.
    let window = [candle(0, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    enable(&state);

    let window_page = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the window read takes the EA's one tick slot");
    assert_eq!(window_page.request.key, CHART_FOOTPRINT_KEY);

    // The quote asks for the forming bar's live re-read while that page awaits its answer: the EA
    // serves one tick request at a time, so the re-read must stay queued rather than cancel it.
    assert!(accept_quote(&events, &state, SESSION, chart_quote(0)).is_some());
    assert!(
        claim_next_tick_request(&state, &state.next_request_id, Instant::now()).is_none(),
        "the live re-read must not go out while the window page is awaited"
    );

    // Answering the window page frees the slot, and the live re-read then goes out.
    assert!(ticks_slots(&state)
        .take_awaited(&window_page.request_id)
        .is_some());
    let answered = page(0, MINUTE_MS, true, &[tick(0, "100", "2", TICK_FLAG_BUY)]);
    assert!(accept_footprint_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));
    let live_page = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the live re-read goes out once the window page is answered");
    assert_eq!(live_page.request.key, CHART_FOOTPRINT_LIVE_KEY);
}

/// The connected EA negotiated the counted pages: footprints then read per-price totals.
fn negotiate_footprint_counts(state: &BridgeState) {
    *state.tick_footprint_counts.lock().unwrap() = true;
}

/// The broker's clock, so a read of the newest bar reaches past its opening millisecond.
fn broker_time(state: &BridgeState, server_time_ms: i64) {
    state.status.lock().unwrap().market_session = Some(MarketSessionView {
        symbol: SYMBOL.into(),
        is_open: true,
        trade_mode: 4,
        server_time_ms,
    });
}

/// Claims the page the read queued and takes it out of the awaited slots, as the wire would.
fn claim_page(state: &BridgeState) -> IndicatorTicksRequest {
    let claimed = claim_next_tick_request(state, &state.next_request_id, Instant::now())
        .expect("the read queued a page");
    ticks_slots(state)
        .take_awaited(&claimed.request_id)
        .expect("the claimed page is awaited")
}

/// The wire levels `texts` names, each a `(price, buy, sell)` triple.
fn wire_levels(texts: &[(&str, &str, &str)]) -> Vec<FootprintLevel> {
    texts
        .iter()
        .map(|(price, buy, sell)| FootprintLevel {
            price: (*price).into(),
            buy: (*buy).into(),
            sell: (*sell).into(),
        })
        .collect()
}

/// The trades an unweighted page's levels name: one per unit of their sides' volumes.
fn counted_trades(levels: &[FootprintLevel]) -> u32 {
    levels
        .iter()
        .map(|level| {
            let buy = level.buy.parse::<u32>().expect("a whole number of trades");
            let sell = level.sell.parse::<u32>().expect("a whole number of trades");
            buy + sell
        })
        .sum()
}

/// One counted page of a footprint read: `texts` as `(price, buy, sell)` levels, every level counted as
/// the whole trades its sides name, and no tick-rule carry.
fn counts_page(
    from_ms: i64,
    to_ms: i64,
    complete: bool,
    through_ms: i64,
    texts: &[(&str, &str, &str)],
) -> TickFootprintHistorySnapshot {
    let levels = wire_levels(texts);
    // An unweighted page counts one trade per unit of volume, so its sides' sums are its trade count.
    let counted = counted_trades(&levels);
    TickFootprintHistorySnapshot {
        request_id: "rust-indicator-ticks-1".into(),
        symbol: SYMBOL.into(),
        from_ms,
        to_ms,
        tick_size: "0.1".into(),
        complete,
        through_ms,
        loaded_ticks: counted,
        trade_ticks: counted,
        carry: None,
        levels,
        bars: Vec::new(),
    }
}

/// One entry of a multi-bar counted page: the open the page counted into and its `(price, buy, sell)`
/// levels, every level counted as the whole trades its sides name.
fn counts_bar(open_ms: i64, texts: &[(&str, &str, &str)]) -> FootprintBarCounts {
    let levels = wire_levels(texts);
    FootprintBarCounts {
        open_ms,
        trade_ticks: counted_trades(&levels),
        levels,
    }
}

/// The trades the bars of a counted page name, which is the page's own count.
fn bars_trade_ticks(bars: &[FootprintBarCounts]) -> u32 {
    bars.iter()
        .map(|bar| bar.trade_ticks)
        .fold(0, u32::saturating_add)
}

/// The opens of the bars a counted request names, oldest first: the open its range starts in and every
/// open it lists after it.
fn request_bar_opens(counts: &TickFootprintHistoryRequest) -> Vec<i64> {
    let first = counts.first_open_ms.unwrap_or(counts.history.from_ms);
    std::iter::once(first)
        .chain(counts.bar_opens.iter().copied())
        .collect()
}

/// The answer to the counted window page `request` asked for, whole: every bar it names counts two
/// bought lots at its open. A page of one bar keeps the top-level levels a single bar's answer has.
fn counted_window_page(request: &IndicatorTicksRequest) -> TickFootprintHistorySnapshot {
    let counts = request.counts_request().expect("a counted page");
    let to_ms = counts.history.to_ms;
    if counts.bar_opens.is_empty() {
        let from_ms = counts.history.from_ms;
        return counts_page(from_ms, to_ms, true, to_ms, &[("100", "2", "0")]);
    }
    let bars: Vec<FootprintBarCounts> = request_bar_opens(&counts)
        .into_iter()
        .map(|open_ms| counts_bar(open_ms, &[("100", "2", "0")]))
        .collect();
    let counted = bars_trade_ticks(&bars);
    TickFootprintHistorySnapshot {
        request_id: "rust-indicator-ticks-1".into(),
        symbol: SYMBOL.into(),
        from_ms: counts.history.from_ms,
        to_ms,
        tick_size: "0.1".into(),
        complete: true,
        through_ms: to_ms,
        loaded_ticks: counted,
        trade_ticks: counted,
        carry: None,
        levels: Vec::new(),
        bars,
    }
}

/// The `tick_footprint_history_snapshot` frame the EA writes for `snapshot`.
fn counts_envelope(snapshot: &TickFootprintHistorySnapshot) -> Envelope {
    Envelope {
        v: PROTOCOL_VERSION,
        message_type: MessageType::TickFootprintHistorySnapshot,
        id: snapshot.request_id.clone(),
        session_id: Some(SESSION.into()),
        sent_at_ms: 1,
        payload: serde_json::to_value(snapshot).expect("a counts payload"),
    }
}

#[test]
fn a_counts_window_read_asks_for_the_newest_run_of_bars_one_page_fits() {
    let window = [
        candle_with_ticks(0, "100", 1),
        candle_with_ticks(MINUTE_MS, "100", 1),
        candle_with_ticks(2 * MINUTE_MS, "100", 1),
    ];
    let (state, _recorded) = chart_state(&window);
    negotiate_footprint_counts(&state);

    enable(&state);

    let queued = claim_page(&state);
    assert_eq!(queued.key, CHART_FOOTPRINT_KEY);
    assert_eq!(
        (queued.page.from_ms, queued.page.to_ms),
        (0, 2 * MINUTE_MS + 1),
        "the run of bars the candles' tick counts fit one page"
    );
    let wire = serde_json::to_value(queued.wire_request()).expect("a wire payload");
    assert_eq!(wire["footprint_counts"], true);
    assert_eq!(
        wire["real_volume"], false,
        "the candle reports no real volume"
    );
    assert_eq!(wire["symbol"], SYMBOL);
    assert_eq!(wire["first_open_ms"], 0);
    assert_eq!(
        wire["bar_opens"],
        serde_json::json!([MINUTE_MS, 2 * MINUTE_MS]),
        "the opens after the bar the range starts in"
    );
    let page_bound = state.transfer_limits.lock().unwrap().max_ticks_per_page;
    assert_eq!(wire["max_ticks"], serde_json::json!(page_bound));
}

#[test]
fn a_counts_window_page_of_one_bar_keeps_the_shape_a_bar_s_page_has() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, _recorded) = chart_state(&window);
    // A page bound of one tick fits the newest bar alone.
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1;
    negotiate_footprint_counts(&state);

    enable(&state);

    let queued = claim_page(&state);
    assert_eq!(queued.page.from_ms, MINUTE_MS, "the newest bar first");
    assert_eq!(queued.page.to_ms, MINUTE_MS + 1);
    let wire = serde_json::to_value(queued.wire_request()).expect("a wire payload");
    assert!(wire.get("bar_opens").is_none(), "a page names no bar");
    assert!(wire.get("first_open_ms").is_none());
}

#[test]
fn a_counts_page_publishes_its_bar_and_asks_for_the_bar_under_it() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    // A page bound of one tick fits the newest bar alone, so the bar under it is the page after.
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1;
    negotiate_footprint_counts(&state);
    enable(&state);
    claim_page(&state);

    let answered = counts_page(
        MINUTE_MS,
        MINUTE_MS + 1,
        true,
        MINUTE_MS + 1,
        &[("100", "2", "1")],
    );
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the page publishes the bar it counted");
    assert_eq!(bar_opens(event), vec![MINUTE_MS]);
    assert_eq!(event["bars"][0]["rows"][0]["row"], 100);
    assert_eq!(event["bars"][0]["rows"][0]["buyVolume"], "2");
    assert_eq!(event["bars"][0]["rows"][0]["sellVolume"], "1");

    let next = claim_page(&state);
    assert_eq!(next.key, CHART_FOOTPRINT_KEY);
    assert_eq!(
        (next.page.from_ms, next.page.to_ms),
        (0, MINUTE_MS),
        "the bar under the one the page counted"
    );
}

#[test]
fn an_incomplete_counts_page_asks_for_the_rest_of_the_bar_with_its_carry() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    broker_time(&state, MINUTE_MS + 30_000);
    // A page bound of one tick fits the forming bar alone, so its page is the rest of that one bar.
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1;
    negotiate_footprint_counts(&state);
    enable(&state);
    let first = claim_page(&state);
    assert_eq!(
        (first.page.from_ms, first.page.to_ms),
        (MINUTE_MS, MINUTE_MS + 30_000)
    );

    let mut answered = counts_page(
        MINUTE_MS,
        MINUTE_MS + 30_000,
        false,
        MINUTE_MS + 10_000,
        &[("100", "1", "0")],
    );
    answered.carry = Some(FootprintCarry {
        price: "100".into(),
        side: FootprintSide::Sell,
    });
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));

    let rest = claim_page(&state);
    assert_eq!(
        (rest.page.from_ms, rest.page.to_ms),
        (MINUTE_MS + 10_000, MINUTE_MS + 30_000),
        "the rest of the bar, from the millisecond the page reached"
    );
    let wire = serde_json::to_value(rest.wire_request()).expect("a wire payload");
    assert_eq!(
        wire["carry"],
        serde_json::json!({"price": "100", "side": "sell"})
    );
    assert!(
        wire.get("bar_opens").is_none(),
        "a page continuing one bar names no bar"
    );
}

#[test]
fn an_incomplete_multi_bar_page_continues_the_bar_it_stopped_in_and_the_run_after_it() {
    let window = [
        candle_with_ticks(0, "100", 1),
        candle_with_ticks(MINUTE_MS, "100", 1),
        candle_with_ticks(2 * MINUTE_MS, "100", 1),
    ];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    broker_time(&state, 2 * MINUTE_MS + 30_000);
    negotiate_footprint_counts(&state);
    enable(&state);
    let first = claim_page(&state);
    assert_eq!(
        (first.page.from_ms, first.page.to_ms),
        (0, 2 * MINUTE_MS + 30_000),
        "one page over the run of three bars"
    );

    // The page counted the oldest bar whole and stopped inside the bar after it, whose trades it did not
    // reach: its last counted bar, and the carry's, is the oldest one.
    let mut answered = counts_page(
        0,
        2 * MINUTE_MS + 30_000,
        false,
        MINUTE_MS + HALF_MINUTE_MS,
        &[],
    );
    answered.bars = vec![counts_bar(0, &[("100", "2", "1")])];
    let counted = bars_trade_ticks(&answered.bars);
    answered.loaded_ticks = counted;
    answered.trade_ticks = counted;
    answered.carry = Some(carry("100", FootprintSide::Buy));
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &answered
    ));

    let rest = claim_page(&state);
    assert_eq!(
        (rest.page.from_ms, rest.page.to_ms),
        (MINUTE_MS + HALF_MINUTE_MS, 2 * MINUTE_MS + 30_000),
        "the bar it stopped in, from the millisecond it reached, and the run after it"
    );
    let wire = serde_json::to_value(rest.wire_request()).expect("a wire payload");
    assert_eq!(
        wire["first_open_ms"], MINUTE_MS,
        "the open of the bar the range starts in"
    );
    assert_eq!(
        wire["bar_opens"],
        serde_json::json!([2 * MINUTE_MS]),
        "only the opens after that bar"
    );
    assert!(
        wire.get("carry").is_none(),
        "the page before ended in another bar, whose open starts a fresh tick rule"
    );
}

/// Answers the window's counts read page by page, as the EA would: every bar a page names counts two
/// bought lots at its open, until the read asks for nothing more.
fn read_counts_window(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    window: &[MarketCandle],
) {
    let mut pages = 0;
    while let Some(claimed) = claim_next_tick_request(state, &state.next_request_id, Instant::now())
    {
        pages += 1;
        assert!(
            pages <= window.len(),
            "a counts window read asks for no more pages than its bars"
        );
        let request = ticks_slots(state)
            .take_awaited(&claimed.request_id)
            .expect("the claimed page is awaited");
        assert_eq!(request.key, CHART_FOOTPRINT_KEY);
        let answered = counted_window_page(&request);
        assert!(accept_footprint_counts_page(
            state,
            events,
            CHART_FOOTPRINT_KEY,
            &answered
        ));
    }
}

/// A chart of `window` reading counted pages, with its window read answered whole: the state the quote
/// path follows a forming bar from.
fn counted_chart(window: &[MarketCandle]) -> (BridgeState, Arc<RecordedEvents>) {
    let (state, recorded) = chart_state(window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    negotiate_footprint_counts(&state);
    enable(&state);
    read_counts_window(&state, &events, window);
    (state, recorded)
}

/// The chart gains the bar opening at `open_ms` and accepts a quote of it: the bar it left behind is
/// read once more, to that bar's own end, and the read for it is queued.
fn chart_moves_on(state: &BridgeState, events: &Arc<dyn BridgeEvents>, open_ms: i64) {
    let newer = BarUpdate {
        symbol: SYMBOL.into(),
        timeframe: TIMEFRAME.into(),
        candle: candle(open_ms, "101"),
    };
    assert_eq!(
        accept_bar_update(state, SESSION, &newer),
        BarUpdateAcceptance::Applied
    );
    assert!(accept_quote(events, state, SESSION, chart_quote(open_ms)).is_some());
}

/// The tick-rule state `price` and `side` name.
fn carry(price: &str, side: FootprintSide) -> FootprintCarry {
    FootprintCarry {
        price: price.into(),
        side,
    }
}

/// Claims the live page the read queued and answers it with `levels` counted to `through_ms`, carrying
/// `carry` as the tick-rule state the page leaves. Answers the claimed page.
fn answer_live_counts_page(
    state: &BridgeState,
    events: &Arc<dyn BridgeEvents>,
    through_ms: i64,
    complete: bool,
    levels: &[(&str, &str, &str)],
    carry: Option<FootprintCarry>,
) -> IndicatorTicksRequest {
    let claimed = claim_page(state);
    assert_eq!(claimed.key, CHART_FOOTPRINT_LIVE_KEY);
    let mut answered = counts_page(
        claimed.page.from_ms,
        claimed.page.to_ms,
        complete,
        through_ms,
        levels,
    );
    answered.carry = carry;
    assert!(accept_footprint_counts_page(
        state,
        events,
        CHART_FOOTPRINT_LIVE_KEY,
        &answered
    ));
    claimed
}

#[test]
fn a_counts_forming_bar_is_read_whole_and_lands_complete_when_the_chart_moves_on() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = counted_chart(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    // The quote makes the host read the forming bar from its open to the broker's time; the window's
    // read of it stops at its opening millisecond, so the chart first hears that it has no footprint.
    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    let live = answer_live_counts_page(
        &state,
        &events,
        MINUTE_MS + 1,
        true,
        &[("100", "3", "2")],
        None,
    );
    assert_eq!(
        (live.page.from_ms, live.page.to_ms),
        (MINUTE_MS, MINUTE_MS + 1)
    );

    let forming = recorded.named(CHART_FOOTPRINT_FORMING_EVENT);
    assert!(
        forming[0]["bar"].is_null(),
        "the window's read of the forming bar stops short of the broker's time"
    );
    let event = forming.last().expect("the whole read publishes the bar");
    assert_eq!(event["bar"]["openMs"], MINUTE_MS);
    assert_eq!(event["bar"]["buyVolume"], "3");
    assert_eq!(event["bar"]["sellVolume"], "2");

    // The chart gains a bar: the bar it left is finished from the millisecond its forming read reached,
    // and lands complete in the window once the rest of it answers.
    chart_moves_on(&state, &events, 2 * MINUTE_MS);
    let closing = claim_page(&state);
    assert_eq!(closing.key, CHART_FOOTPRINT_LIVE_KEY);
    assert_eq!(
        (closing.page.from_ms, closing.page.to_ms),
        (MINUTE_MS + 1, 2 * MINUTE_MS),
        "the rest of the bar the chart left"
    );
    let answered = counts_page(
        closing.page.from_ms,
        closing.page.to_ms,
        true,
        2 * MINUTE_MS,
        &[("100", "4", "1")],
    );
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY,
        &answered
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the landed bar publishes the window again");
    assert_eq!(bar_opens(event), vec![0, MINUTE_MS]);
    assert_eq!(
        event["bars"][1]["buyVolume"], "7",
        "the levels the forming read counted and the rest of the bar"
    );
    assert_eq!(event["bars"][1]["sellVolume"], "3");
    assert!(event["incomplete"]
        .as_array()
        .expect("the incomplete bars are a list")
        .is_empty());
}

#[test]
fn a_left_bar_s_closing_page_asks_on_from_its_forming_read_with_its_carry() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = counted_chart(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    answer_live_counts_page(
        &state,
        &events,
        MINUTE_MS + 1,
        false,
        &[("100", "3", "2")],
        Some(carry("100", FootprintSide::Buy)),
    );

    chart_moves_on(&state, &events, 2 * MINUTE_MS);

    let closing = claim_page(&state);
    assert_eq!(closing.key, CHART_FOOTPRINT_LIVE_KEY);
    assert_eq!(
        (closing.page.from_ms, closing.page.to_ms),
        (MINUTE_MS + 1, 2 * MINUTE_MS),
        "the rest of the bar, from the millisecond the forming read reached"
    );
    let wire = serde_json::to_value(closing.wire_request()).expect("a wire payload");
    assert_eq!(
        wire["carry"],
        serde_json::json!({"price": "100", "side": "buy"}),
        "the tick-rule state the forming read left"
    );
}

#[test]
fn a_left_bar_keeps_its_counted_footprint_while_its_closing_read_is_in_flight() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = counted_chart(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    answer_live_counts_page(
        &state,
        &events,
        MINUTE_MS + 1,
        true,
        &[("100", "3", "2")],
        None,
    );

    chart_moves_on(&state, &events, 2 * MINUTE_MS);
    let closing = claim_page(&state);
    assert_eq!(
        (closing.page.from_ms, closing.page.to_ms),
        (MINUTE_MS + 1, 2 * MINUTE_MS),
        "the closing read is in flight and unanswered"
    );

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published.last().expect("the move publishes the window");
    assert_eq!(
        bar_opens(event),
        vec![0, MINUTE_MS],
        "the bar the chart left keeps a footprint"
    );
    assert_eq!(
        event["bars"][1]["buyVolume"], "3",
        "the levels the forming read counted so far"
    );
    assert_eq!(event["bars"][1]["sellVolume"], "2");
    assert!(
        event["incomplete"]
            .as_array()
            .expect("the incomplete bars are a list")
            .is_empty(),
        "the bar is not reported as stopped inside"
    );
    let forming = recorded.named(CHART_FOOTPRINT_FORMING_EVENT);
    assert!(
        forming.last().expect("the forming bar's event")["bar"].is_null(),
        "the new forming bar has no read yet"
    );
}

#[test]
fn the_new_forming_bar_s_first_page_follows_the_closing_read_without_a_quote() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = counted_chart(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    answer_live_counts_page(
        &state,
        &events,
        MINUTE_MS + 1,
        true,
        &[("100", "3", "2")],
        None,
    );
    chart_moves_on(&state, &events, 2 * MINUTE_MS);
    let closing = claim_page(&state);
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY,
        &counts_page(
            closing.page.from_ms,
            closing.page.to_ms,
            true,
            2 * MINUTE_MS,
            &[("100", "4", "1")],
        )
    ));

    let next = claim_page(&state);
    assert_eq!(next.key, CHART_FOOTPRINT_LIVE_KEY);
    assert_eq!(
        (next.page.from_ms, next.page.to_ms),
        (2 * MINUTE_MS, 2 * MINUTE_MS + 1),
        "the new forming bar's first page, from its open"
    );

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the landed bar publishes the window");
    assert_eq!(bar_opens(event), vec![0, MINUTE_MS]);
    assert_eq!(event["bars"][1]["buyVolume"], "7");
    assert_eq!(event["bars"][1]["sellVolume"], "3");
}

#[test]
fn a_forming_bar_no_read_followed_closes_with_a_read_from_its_open() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = counted_chart(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();

    // The forming bar's read never lands: the EA fails it, so no counts follow the bar.
    assert!(accept_quote(&events, &state, SESSION, chart_quote(MINUTE_MS)).is_some());
    claim_page(&state);
    assert!(abandon_footprint_read(
        &state,
        &events,
        CHART_FOOTPRINT_LIVE_KEY
    ));

    chart_moves_on(&state, &events, 2 * MINUTE_MS);

    let closing = claim_page(&state);
    assert_eq!(closing.key, CHART_FOOTPRINT_LIVE_KEY);
    assert_eq!(
        (closing.page.from_ms, closing.page.to_ms),
        (MINUTE_MS, 2 * MINUTE_MS),
        "a bar no forming read holds is read from its open"
    );
}

#[test]
fn a_counts_page_that_makes_no_progress_marks_its_bar_incomplete() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    broker_time(&state, MINUTE_MS + 30_000);
    // A page bound of one tick fits the forming bar alone, which is the bar the stalled page belongs to.
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1;
    negotiate_footprint_counts(&state);
    enable(&state);
    claim_page(&state);

    // A page ending where it started certified no progress, and counts cannot be resumed inside a
    // millisecond: the bar it belongs to keeps no ticks and its levels are dropped.
    let stalled = counts_page(MINUTE_MS, MINUTE_MS + 30_000, false, MINUTE_MS, &[]);
    assert!(accept_footprint_counts_page(
        &state,
        &events,
        CHART_FOOTPRINT_KEY,
        &stalled
    ));

    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the stopped read publishes its state");
    assert!(
        event["bars"]
            .as_array()
            .expect("the bars are a list")
            .is_empty(),
        "a bar no page took whole has no footprint"
    );
    assert_eq!(event["incompleteBefore"], MINUTE_MS);
    assert_eq!(event["incomplete"], serde_json::json!([MINUTE_MS]));
    assert!(
        claim_next_tick_request(&state, &state.next_request_id, Instant::now()).is_none(),
        "no page follows a stopped read"
    );
}

#[test]
fn a_chart_without_the_footprint_counts_capability_reads_raw_ticks() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, _recorded) = chart_state(&window);

    enable(&state);

    let queued = claim_page(&state);
    assert_eq!(queued.key, CHART_FOOTPRINT_KEY);
    assert!(
        queued.footprint_counts.is_none(),
        "an older EA keeps the raw page"
    );
    let wire = serde_json::to_value(queued.wire_request()).expect("a wire payload");
    assert!(wire.get("footprint_counts").is_none());
    assert!(wire.get("carry").is_none());
    assert_eq!(wire["symbol"], SYMBOL);
}

#[test]
fn a_counts_snapshot_under_a_stale_id_is_ignored_and_the_awaited_one_fills_the_bar() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    // A page bound of one tick fits the newest bar alone, which is the bar the answered page names.
    state.transfer_limits.lock().unwrap().max_ticks_per_page = 1;
    negotiate_footprint_counts(&state);
    enable(&state);
    let claimed = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the newest bar's page");
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::unavailable());
    let inbound = Inbound {
        events: &events,
        state: &state,
        adapter: &adapter,
        session_id: SESSION,
    };
    let mut answered = counts_page(
        MINUTE_MS,
        MINUTE_MS + 1,
        true,
        MINUTE_MS + 1,
        &[("100", "2", "1")],
    );

    answered.request_id = "rust-indicator-ticks-stale".into();
    assert!(matches!(
        footprint_counts_snapshot(&inbound, counts_envelope(&answered)),
        InboundOutcome::Continue
    ));
    assert!(
        recorded.named(CHART_FOOTPRINT_EVENT).is_empty(),
        "a stale id answers no read"
    );

    answered.request_id = claimed.request_id.clone();
    assert!(matches!(
        footprint_counts_snapshot(&inbound, counts_envelope(&answered)),
        InboundOutcome::Continue
    ));
    assert_eq!(
        recorded.named(CHART_FOOTPRINT_EVENT).len(),
        1,
        "the awaited page publishes the bar it counted"
    );
}

#[test]
fn a_counts_snapshot_that_does_not_answer_its_request_ends_the_read() {
    let window = [candle(0, "100"), candle(MINUTE_MS, "100")];
    let (state, recorded) = chart_state(&window);
    let events: Arc<dyn BridgeEvents> = recorded.clone();
    negotiate_footprint_counts(&state);
    enable(&state);
    let claimed = claim_next_tick_request(&state, &state.next_request_id, Instant::now())
        .expect("the newest bar's page");
    let adapter = ExecutionAdapterState::new(ExecutionSafetyState::unavailable());
    let inbound = Inbound {
        events: &events,
        state: &state,
        adapter: &adapter,
        session_id: SESSION,
    };

    // The page's range is not the one the read asked for: it is handled like a correlated error, so
    // the read it answers ends and asks for nothing more.
    let mut foreign = counts_page(
        MINUTE_MS + 1,
        MINUTE_MS + 1,
        true,
        MINUTE_MS + 1,
        &[("100", "2", "1")],
    );
    foreign.request_id = claimed.request_id.clone();
    assert!(matches!(
        footprint_counts_snapshot(&inbound, counts_envelope(&foreign)),
        InboundOutcome::Continue
    ));
    assert!(
        claim_next_tick_request(&state, &state.next_request_id, Instant::now()).is_none(),
        "the read it ended asks for no more pages"
    );
    let published = recorded.named(CHART_FOOTPRINT_EVENT);
    let event = published
        .last()
        .expect("the ended read publishes its state");
    assert!(event["bars"]
        .as_array()
        .expect("the bars are a list")
        .is_empty());
}
