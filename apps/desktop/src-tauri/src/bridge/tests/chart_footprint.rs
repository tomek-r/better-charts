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
use trading_core::protocol::MarketTick;

const SESSION: &str = "session-1";
const SYMBOL: &str = "NAS100";
const TIMEFRAME: &str = "M1";
const MINUTE_MS: i64 = 60_000;
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
