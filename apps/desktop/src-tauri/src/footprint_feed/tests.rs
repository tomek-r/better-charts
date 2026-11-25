use super::{
    footprint_window, forming_bars, group_ticks, to_trade_tick, BarSpan, FootprintFeed,
    FootprintTicks, FormingBars, PageAnswer, PageOutcome, TickPage, FORMING_REREAD_INTERVAL,
};
use rust_decimal::Decimal;
use std::time::{Duration, Instant};
use trading_core::footprint::{FootprintTick, TickSide, TICK_FLAG_BUY, TICK_FLAG_SELL};
use trading_core::protocol::{MarketCandle, MarketTick};

const MINUTE_MS: i64 = 60_000;
/// Ticks the read budget of these tests allows, so a handful of pages reach it.
const SMALL_BUDGET: u32 = 4;
/// The largest page the tests' EA answers with.
const PAGE_BOUND: u32 = 2;
/// A budget no test read can spend.
const WIDE_BUDGET: usize = 100;

/// The decimal `value` names.
fn dec(value: &str) -> Decimal {
    value.parse().expect("a decimal")
}

/// A bar closing at `close`, as the bridge accepted it.
fn candle(time_ms: i64, close: &str) -> MarketCandle {
    MarketCandle {
        time_ms,
        open: close.to_string(),
        high: close.to_string(),
        low: close.to_string(),
        close: close.to_string(),
        tick_volume: 10,
        spread: 0,
        real_volume: 0,
    }
}

/// One wire tick whose every price field is `price`.
fn wire_tick(time_ms: i64, price: &str, volume_real: &str, flags: u32) -> MarketTick {
    MarketTick {
        time_ms,
        bid: price.to_string(),
        ask: price.to_string(),
        last: price.to_string(),
        volume: 1,
        volume_real: volume_real.to_string(),
        flags,
    }
}

/// Three M1 bars opening every minute from 0; the newest reaches `read_end_ms`.
fn three_minutes(read_end_ms: i64) -> Vec<BarSpan> {
    footprint_window(
        &[
            candle(0, "100"),
            candle(MINUTE_MS, "100"),
            candle(2 * MINUTE_MS, "100"),
        ],
        read_end_ms,
    )
}

/// The page the EA answered with `ticks`, and whether it held its whole range.
fn answered(ticks: &[MarketTick], complete: bool) -> PageAnswer<'_> {
    PageAnswer { ticks, complete }
}

/// A one-bar window opening at `open_ms` and ending a minute later.
fn one_minute(open_ms: i64) -> Vec<BarSpan> {
    vec![BarSpan {
        open_ms,
        end_ms: open_ms + MINUTE_MS,
    }]
}

/// The chart's forming bar opening at `open_ms`, with the bar before it.
fn forming(open_ms: i64) -> FormingBars {
    FormingBars {
        forming: BarSpan {
            open_ms,
            end_ms: open_ms + MINUTE_MS,
        },
        closed: Some(BarSpan {
            open_ms: open_ms - MINUTE_MS,
            end_ms: open_ms,
        }),
    }
}

#[test]
fn a_tick_belongs_to_the_bar_whose_span_holds_it() {
    let bars = three_minutes(3 * MINUTE_MS);
    let ticks = [
        wire_tick(0, "100", "1", TICK_FLAG_BUY),
        wire_tick(MINUTE_MS - 1, "100", "1", TICK_FLAG_BUY),
        wire_tick(MINUTE_MS, "100", "1", TICK_FLAG_SELL),
        wire_tick(4 * MINUTE_MS, "100", "1", TICK_FLAG_SELL),
    ];

    let by_bar = group_ticks(&ticks, &bars);

    assert_eq!(
        by_bar.keys().copied().collect::<Vec<_>>(),
        vec![0, MINUTE_MS, 2 * MINUTE_MS]
    );
    assert_eq!(
        by_bar[&0].len(),
        2,
        "the first bar holds up to its next open"
    );
    assert_eq!(
        by_bar[&MINUTE_MS].len(),
        1,
        "a tick at a bar's open starts that bar"
    );
    assert_eq!(
        by_bar[&(2 * MINUTE_MS)][0].time_ms,
        4 * MINUTE_MS,
        "the newest bar is open-ended"
    );
}

#[test]
fn a_tick_before_the_window_belongs_to_no_bar() {
    let bars = three_minutes(3 * MINUTE_MS);
    let ticks = [wire_tick(-1, "100", "1", TICK_FLAG_BUY)];

    assert!(group_ticks(&ticks, &bars).is_empty());
}

#[test]
fn the_newest_bar_ends_at_the_read_end() {
    let bars = three_minutes(5 * MINUTE_MS);

    assert_eq!(
        bars,
        vec![
            BarSpan {
                open_ms: 0,
                end_ms: MINUTE_MS,
            },
            BarSpan {
                open_ms: MINUTE_MS,
                end_ms: 2 * MINUTE_MS,
            },
            BarSpan {
                open_ms: 2 * MINUTE_MS,
                end_ms: 5 * MINUTE_MS,
            },
        ]
    );
}

#[test]
fn a_read_end_before_the_newest_bar_keeps_its_own_span() {
    let bars = three_minutes(0);

    assert_eq!(bars[2].end_ms, 2 * MINUTE_MS + 1);
    assert_eq!(bars[1].end_ms, 2 * MINUTE_MS);
}

#[test]
fn the_forming_bar_and_the_one_before_it_end_where_the_chart_says() {
    let bars = forming_bars(
        &[
            candle(0, "100"),
            candle(MINUTE_MS, "100"),
            candle(2 * MINUTE_MS, "100"),
        ],
        3 * MINUTE_MS,
    )
    .expect("three bars hold a forming one");

    assert_eq!(
        bars,
        FormingBars {
            forming: BarSpan {
                open_ms: 2 * MINUTE_MS,
                end_ms: 3 * MINUTE_MS,
            },
            closed: Some(BarSpan {
                open_ms: MINUTE_MS,
                end_ms: 2 * MINUTE_MS,
            }),
        }
    );
    assert!(
        forming_bars(&[candle(0, "100")], 0)
            .expect("one bar is a forming one")
            .closed
            .is_none(),
        "a lone bar has nothing before it"
    );
    assert!(forming_bars(&[], 0).is_none());
}

#[test]
fn the_last_price_is_the_traded_price_and_the_bid_stands_in_for_it() {
    let mut tick = wire_tick(1_000, "1.5", "1", TICK_FLAG_BUY);
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.price),
        Some(dec("1.5"))
    );

    tick.last = "1.6".to_string();
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.price),
        Some(dec("1.6")),
        "the last price wins over the bid"
    );

    tick.last = "0".to_string();
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.price),
        Some(dec("1.5")),
        "a last of zero is no price at all"
    );

    tick.bid = "0".to_string();
    assert!(
        to_trade_tick(&tick).is_none(),
        "a tick with no positive price names no trade"
    );
}

#[test]
fn the_real_volume_is_the_traded_volume_and_the_tick_count_stands_in_for_it() {
    let mut tick = wire_tick(1_000, "1.5", "2.75", TICK_FLAG_BUY);
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.volume),
        Some(dec("2.75")),
        "the real volume wins"
    );

    tick.volume_real = "0".to_string();
    tick.volume = 7;
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.volume),
        Some(dec("7")),
        "a symbol without real volume trades one tick at a time"
    );
}

#[test]
fn the_flags_name_the_side_and_time_of_the_trade() {
    let tick = wire_tick(1_234, "1.5", "0", TICK_FLAG_SELL);

    assert_eq!(
        to_trade_tick(&tick),
        Some(FootprintTick {
            time_ms: 1_234,
            price: dec("1.5"),
            volume: dec("1"),
            side: TickSide::Sell,
        }),
        "a tick without real volume trades its one tick"
    );
    assert_eq!(
        to_trade_tick(&wire_tick(1, "1.5", "1", 0)).map(|trade| trade.side),
        Some(TickSide::Unknown),
        "an unflagged tick converts, with no side of its own"
    );
}

#[test]
fn an_unreadable_price_names_no_trade() {
    let tick = MarketTick {
        last: "not a price".to_string(),
        bid: "1.5".to_string(),
        ..wire_tick(1, "1.5", "1", TICK_FLAG_BUY)
    };

    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.price),
        Some(dec("1.5")),
        "the bid still names a price"
    );
    let unreadable = MarketTick {
        bid: "also not a price".to_string(),
        ..tick
    };
    assert!(to_trade_tick(&unreadable).is_none());
}

#[test]
fn a_read_covers_the_newest_bars_and_stops_at_the_budget() {
    let budget = usize::try_from(SMALL_BUDGET).expect("a small budget fits a usize");
    let mut read =
        FootprintTicks::new(three_minutes(3 * MINUTE_MS), budget).expect("a window of bars");

    let newest = read.next_page(PAGE_BOUND).expect("the newest bar first");
    assert_eq!(
        (newest.first_bar, newest.from_ms, newest.to_ms),
        (2, 2 * MINUTE_MS, 3 * MINUTE_MS)
    );
    read.accept(answered(
        &[
            wire_tick(2 * MINUTE_MS + 1, "100", "1", TICK_FLAG_BUY),
            wire_tick(2 * MINUTE_MS + 2, "100", "1", TICK_FLAG_BUY),
        ],
        true,
    ));

    let older = read.next_page(PAGE_BOUND).expect("the bars under it next");
    assert_eq!(older.first_bar, 0, "a page that fitted asks for more bars");
    assert_eq!(
        older.max_ticks,
        SMALL_BUDGET - PAGE_BOUND,
        "only the ticks the budget has left"
    );
    read.accept(answered(
        &[
            wire_tick(0, "100", "1", TICK_FLAG_BUY),
            wire_tick(MINUTE_MS + 1, "100", "1", TICK_FLAG_BUY),
        ],
        false,
    ));

    let middle = read
        .next_page(PAGE_BOUND)
        .expect("half the bars, after a page held too many");
    assert_eq!(middle.first_bar, 1);
    assert_eq!((middle.from_ms, middle.to_ms), (MINUTE_MS, 2 * MINUTE_MS));
    read.accept(answered(
        &[
            wire_tick(MINUTE_MS + 1, "100", "1", TICK_FLAG_BUY),
            wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_BUY),
        ],
        true,
    ));

    assert!(
        read.next_page(PAGE_BOUND).is_none(),
        "the budget is spent, so the oldest bar reads na"
    );
    let kept = read.finish();
    assert!(
        kept.incomplete.is_none(),
        "a budget spent between bars leaves no bar partial"
    );
    assert_eq!(kept.ticks.len(), 2);
    assert!(
        !kept.ticks.contains_key(&0),
        "a bar older than the budget reaches has no trades"
    );
    assert_eq!(kept.ticks[&MINUTE_MS].len(), 2);
    assert_eq!(kept.ticks[&(2 * MINUTE_MS)].len(), 2);
}

#[test]
fn a_bar_holding_more_ticks_than_one_page_is_paged_through() {
    let mut read = FootprintTicks::new(three_minutes(3 * MINUTE_MS), WIDE_BUDGET)
        .expect("three bars are a window");

    read.next_page(PAGE_BOUND).expect("the newest bar first");
    read.accept(answered(
        &[
            wire_tick(2 * MINUTE_MS + 1, "100", "1", TICK_FLAG_BUY),
            wire_tick(2 * MINUTE_MS + 2, "100", "1", TICK_FLAG_BUY),
        ],
        false,
    ));

    let within = read.next_page(PAGE_BOUND).expect("the same bar again");
    assert_eq!(within.first_bar, 2);
    assert_eq!(
        within.from_ms,
        2 * MINUTE_MS + 2,
        "the millisecond the page stopped in is asked for again"
    );

    read.accept(answered(
        &[
            wire_tick(2 * MINUTE_MS + 2, "100", "1", TICK_FLAG_BUY),
            wire_tick(2 * MINUTE_MS + 3, "100", "1", TICK_FLAG_BUY),
        ],
        true,
    ));
    let next = read.next_page(PAGE_BOUND).expect("the bars under it");
    assert_eq!(
        (next.first_bar, next.to_ms),
        (0, 2 * MINUTE_MS),
        "the bar that did not fit is read once, and the older bars follow"
    );
}

#[test]
fn a_bar_too_big_for_one_millisecond_is_incomplete_and_kept_out_of_the_readable_ticks() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the bar's page");

    let overflowed = feed.accept_page(
        answered(
            &[
                wire_tick(0, "100", "1", TICK_FLAG_BUY),
                wire_tick(0, "100", "1", TICK_FLAG_BUY),
            ],
            false,
        ),
        PAGE_BOUND,
    );

    assert_eq!(
        overflowed,
        PageOutcome::Finished,
        "a millisecond holding more ticks than a page ends the read"
    );
    assert!(
        feed.complete_ticks().is_empty(),
        "an incomplete bar's ticks never reach the observer"
    );
    assert_eq!(feed.incomplete_bars(), &[0]);
}

#[test]
fn a_budget_spent_inside_a_bar_leaves_it_incomplete() {
    let mut read = FootprintTicks::new(one_minute(0), 2).expect("a bar and a budget");

    read.next_page(PAGE_BOUND).expect("the bar's page");
    read.accept(answered(
        &[
            wire_tick(1, "100", "1", TICK_FLAG_BUY),
            wire_tick(2, "100", "1", TICK_FLAG_BUY),
        ],
        false,
    ));

    assert!(
        read.next_page(PAGE_BOUND).is_none(),
        "the page's ticks spent the whole budget inside the bar"
    );
    let kept = read.finish();
    assert!(
        kept.ticks.is_empty(),
        "the bar is never kept half read, not even the pages it answered"
    );
    assert_eq!(kept.incomplete, Some(0));
}

#[test]
fn a_read_keeps_exactly_the_ticks_of_the_bars_it_took_whole() {
    let mut feed = FootprintFeed::default();
    feed.start(three_minutes(3 * MINUTE_MS), PAGE_BOUND)
        .expect("the newest bar's page");
    feed.accept_page(
        answered(
            &[
                wire_tick(2 * MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(2 * MINUTE_MS + 7, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );
    let finished = feed.accept_page(
        answered(
            &[
                wire_tick(5, "100", "3", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS - 1, "100", "4", TICK_FLAG_BUY),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    assert_eq!(finished, PageOutcome::Finished);
    let ticks = feed.complete_ticks();
    assert_eq!(
        ticks.keys().copied().collect::<Vec<_>>(),
        vec![0, 2 * MINUTE_MS],
        "the bar no page reached has no trades"
    );
    assert_eq!(
        ticks[&0]
            .iter()
            .map(|trade| (trade.time_ms, trade.volume))
            .collect::<Vec<_>>(),
        vec![(5, dec("3")), (MINUTE_MS - 1, dec("4"))]
    );
    assert_eq!(
        ticks[&(2 * MINUTE_MS)]
            .iter()
            .map(|trade| (trade.time_ms, trade.volume))
            .collect::<Vec<_>>(),
        vec![(2 * MINUTE_MS + 1, dec("2")), (2 * MINUTE_MS + 7, dec("1")),]
    );
    assert!(feed.incomplete_bars().is_empty());
}

#[test]
fn the_observer_reads_every_whole_bar_and_the_forming_bars_last_reread() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");
    feed.accept_page(
        answered(&[wire_tick(1, "100", "1", TICK_FLAG_BUY)], true),
        PAGE_BOUND,
    );

    feed.follow_forming_bar(forming(MINUTE_MS), Instant::now(), PAGE_BOUND)
        .page
        .expect("the forming bar's first read");
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let ticks = feed.complete_ticks();
    assert_eq!(
        ticks.keys().copied().collect::<Vec<_>>(),
        vec![0, MINUTE_MS],
        "the whole bar and the forming bar's whole re-read, each under its open"
    );
    assert_eq!(ticks[&0].len(), 1);
    assert_eq!(
        ticks[&MINUTE_MS]
            .iter()
            .map(|trade| (trade.time_ms, trade.side))
            .collect::<Vec<_>>(),
        vec![
            (MINUTE_MS + 1, TickSide::Buy),
            (MINUTE_MS + 2, TickSide::Sell),
        ]
    );
}

#[test]
fn the_forming_reread_replaces_the_forming_bar_ticks_and_is_throttled() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");
    feed.accept_page(
        answered(&[wire_tick(1, "100", "1", TICK_FLAG_BUY)], true),
        PAGE_BOUND,
    );

    let start = Instant::now();
    let step = feed.follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND);
    let first = step.page.expect("the forming bar's first read");
    assert_eq!(
        (first.first_bar, first.from_ms, first.to_ms),
        (0, MINUTE_MS, 2 * MINUTE_MS)
    );
    assert_eq!(
        feed.accept_live_page(
            answered(
                &[
                    wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                    wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                ],
                true,
            ),
            PAGE_BOUND,
        ),
        PageOutcome::Finished
    );
    assert_eq!(feed.complete_ticks()[&MINUTE_MS].len(), 2);

    let inside = start + FORMING_REREAD_INTERVAL / 2;
    let throttled = feed.follow_forming_bar(forming(MINUTE_MS), inside, PAGE_BOUND);
    assert_eq!(
        throttled.page, None,
        "a quote inside the interval reads nothing"
    );

    let after = start + FORMING_REREAD_INTERVAL;
    let next = feed.follow_forming_bar(forming(MINUTE_MS), after, PAGE_BOUND);
    let second = next.page.expect("the next re-read");
    assert_eq!(
        second.from_ms,
        MINUTE_MS + 2,
        "the re-read asks from the last millisecond the whole read reached"
    );
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                wire_tick(MINUTE_MS + 3, "100", "5", TICK_FLAG_BUY),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let ticks = feed.complete_ticks();
    assert_eq!(
        ticks[&MINUTE_MS].len(),
        3,
        "a whole re-read replaces the forming bar's ticks from the millisecond it asks from"
    );
    assert_eq!(ticks[&0].len(), 1, "other bars keep their ticks");
    assert!(feed.incomplete_bars().is_empty());
}

#[test]
fn the_incremental_reread_keeps_the_ticks_before_the_millisecond_it_asks_from() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    let first = feed
        .follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND)
        .page
        .expect("the forming bar's first read");
    assert_eq!(
        first.from_ms, MINUTE_MS,
        "the first read of the bar starts at its open"
    );
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let reread_at = start + FORMING_REREAD_INTERVAL;
    let second = feed
        .follow_forming_bar(forming(MINUTE_MS), reread_at, PAGE_BOUND)
        .page
        .expect("the next re-read");
    assert_eq!(
        (second.first_bar, second.from_ms, second.to_ms),
        (0, MINUTE_MS + 2, 2 * MINUTE_MS),
        "the re-read asks only from the last millisecond the whole read reached"
    );

    // MT5 added a tick to that millisecond: the page carries the millisecond again, whole.
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                wire_tick(MINUTE_MS + 2, "100", "3", TICK_FLAG_SELL),
                wire_tick(MINUTE_MS + 3, "100", "5", TICK_FLAG_BUY),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    assert_eq!(
        feed.complete_ticks()[&MINUTE_MS]
            .iter()
            .map(|trade| (trade.time_ms, trade.volume))
            .collect::<Vec<_>>(),
        vec![
            (MINUTE_MS + 1, dec("2")),
            (MINUTE_MS + 2, dec("1")),
            (MINUTE_MS + 2, dec("3")),
            (MINUTE_MS + 3, dec("5")),
        ],
        "the ticks before the asked millisecond are kept and the one asked for is counted once"
    );
    assert!(feed.incomplete_bars().is_empty());
}

#[test]
fn an_overflowing_reread_drops_the_forming_bar_and_the_next_one_starts_at_its_open() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    let first = feed
        .follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND)
        .page
        .expect("the forming bar's first read");
    assert_eq!(first.from_ms, MINUTE_MS);
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );
    assert_eq!(feed.complete_ticks()[&MINUTE_MS].len(), 2);

    let reread_at = start + FORMING_REREAD_INTERVAL;
    let resumed = feed
        .follow_forming_bar(forming(MINUTE_MS), reread_at, PAGE_BOUND)
        .page
        .expect("the next re-read");
    assert_eq!(resumed.from_ms, MINUTE_MS + 2);

    // The range from the resumed millisecond holds more ticks than a page: the incremental read has
    // no whole range to keep.
    assert_eq!(
        feed.accept_live_page(
            answered(
                &[
                    wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                    wire_tick(MINUTE_MS + 3, "100", "6", TICK_FLAG_BUY),
                ],
                false,
            ),
            PAGE_BOUND,
        ),
        PageOutcome::Finished
    );
    assert!(
        !feed.complete_ticks().contains_key(&MINUTE_MS),
        "the forming bar stopped being read whole, so it reads na"
    );

    let after_fallback = reread_at + FORMING_REREAD_INTERVAL;
    let following = feed
        .follow_forming_bar(forming(MINUTE_MS), after_fallback, PAGE_BOUND)
        .page
        .expect("the re-read after the fallback");
    assert_eq!(
        (following.first_bar, following.from_ms, following.to_ms),
        (0, MINUTE_MS, 2 * MINUTE_MS),
        "the fallback starts the re-read at the bar's open again"
    );
}

#[test]
fn a_reread_the_ea_cannot_answer_drops_the_forming_bar_and_the_next_one_starts_at_its_open() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    feed.follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND)
        .page
        .expect("the forming bar's first read");
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let reread_at = start + FORMING_REREAD_INTERVAL;
    let resumed = feed
        .follow_forming_bar(forming(MINUTE_MS), reread_at, PAGE_BOUND)
        .page
        .expect("the next re-read");
    assert_eq!(resumed.from_ms, MINUTE_MS + 2);

    assert!(
        feed.abandon_live_read(),
        "the forming bar lost its whole ticks"
    );
    assert!(!feed.complete_ticks().contains_key(&MINUTE_MS));

    let after_error = reread_at + FORMING_REREAD_INTERVAL;
    let next = feed
        .follow_forming_bar(forming(MINUTE_MS), after_error, PAGE_BOUND)
        .page
        .expect("the re-read after the error");
    assert_eq!(next.from_ms, MINUTE_MS, "it starts at the bar's open again");
}

#[test]
fn the_closing_read_resumes_from_the_last_millisecond_of_the_whole_reread() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    let opening = feed
        .follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND)
        .page
        .expect("the forming bar's read");
    assert_eq!(opening.from_ms, MINUTE_MS);
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let closed_at = start + Duration::from_millis(200);
    let closing = feed.follow_forming_bar(forming(2 * MINUTE_MS), closed_at, PAGE_BOUND);
    let closing_page = closing.page.expect("the closed bar's last read");
    assert_eq!(
        (
            closing_page.first_bar,
            closing_page.from_ms,
            closing_page.to_ms
        ),
        (0, MINUTE_MS + 2, 2 * MINUTE_MS),
        "the last read of the closed bar resumes where the whole re-read stopped"
    );

    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                wire_tick(MINUTE_MS + 5, "100", "4", TICK_FLAG_BUY),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    assert_eq!(
        feed.complete_ticks()[&MINUTE_MS]
            .iter()
            .map(|trade| (trade.time_ms, trade.volume))
            .collect::<Vec<_>>(),
        vec![
            (MINUTE_MS + 1, dec("2")),
            (MINUTE_MS + 2, dec("1")),
            (MINUTE_MS + 5, dec("4")),
        ],
        "the closed bar holds the ticks before the resumed millisecond and those from it on"
    );
    assert!(feed.incomplete_bars().is_empty());
}

#[test]
fn a_closing_read_that_overflows_its_page_is_read_again_from_the_bar_open() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    feed.follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND)
        .page
        .expect("the forming bar's read");
    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 1, "100", "2", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let closed_at = start + Duration::from_millis(200);
    feed.follow_forming_bar(forming(2 * MINUTE_MS), closed_at, PAGE_BOUND)
        .page
        .expect("the closed bar's last read");

    let restarted = feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 2, "100", "1", TICK_FLAG_SELL),
                wire_tick(MINUTE_MS + 3, "100", "6", TICK_FLAG_BUY),
            ],
            false,
        ),
        PAGE_BOUND,
    );
    assert_eq!(
        restarted,
        PageOutcome::Next(TickPage {
            first_bar: 0,
            from_ms: MINUTE_MS,
            to_ms: 2 * MINUTE_MS,
            max_ticks: PAGE_BOUND,
        }),
        "a closed bar has no later read to fall back on, so it is read from its open"
    );
    assert!(
        !feed.complete_ticks().contains_key(&MINUTE_MS),
        "the bar reads na until that whole read lands"
    );
}

#[test]
fn a_closed_bar_is_reread_to_its_end_and_becomes_complete() {
    let mut feed = FootprintFeed::default();
    feed.start(
        vec![
            BarSpan {
                open_ms: 0,
                end_ms: MINUTE_MS,
            },
            BarSpan {
                open_ms: MINUTE_MS,
                end_ms: 2 * MINUTE_MS,
            },
        ],
        PAGE_BOUND,
    )
    .expect("the newest bar's page");
    feed.accept_page(
        answered(&[wire_tick(MINUTE_MS, "100", "1", TICK_FLAG_BUY)], true),
        PAGE_BOUND,
    );
    feed.accept_page(
        answered(&[wire_tick(1, "100", "3", TICK_FLAG_BUY)], true),
        PAGE_BOUND,
    );

    let start = Instant::now();
    let opening = feed.follow_forming_bar(forming(MINUTE_MS), start, PAGE_BOUND);
    assert!(opening.page.is_some(), "the forming bar's first read");
    assert!(
        opening.ticks_dropped,
        "the window's read of the forming bar stops before the broker's time"
    );
    feed.accept_live_page(
        answered(&[wire_tick(MINUTE_MS, "100", "2", TICK_FLAG_SELL)], true),
        PAGE_BOUND,
    );
    assert_eq!(feed.complete_ticks()[&MINUTE_MS].len(), 1);

    let closed_at = start + Duration::from_millis(200);
    let closing = feed.follow_forming_bar(forming(2 * MINUTE_MS), closed_at, PAGE_BOUND);
    assert!(
        closing.ticks_dropped,
        "the closed bar reads na until its last read lands"
    );
    let closing_page = closing.page.expect("the closed bar's last read");
    assert_eq!(
        (closing_page.from_ms, closing_page.to_ms),
        (MINUTE_MS, 2 * MINUTE_MS),
        "the bar is read to its own end"
    );
    assert!(
        !feed.complete_ticks().contains_key(&MINUTE_MS),
        "a closed bar without its last read yet has no footprint"
    );

    feed.accept_live_page(
        answered(
            &[
                wire_tick(MINUTE_MS + 10, "100", "1", TICK_FLAG_BUY),
                wire_tick(MINUTE_MS + 20, "100", "4", TICK_FLAG_SELL),
            ],
            true,
        ),
        PAGE_BOUND,
    );

    let ticks = feed.complete_ticks();
    assert_eq!(
        ticks[&MINUTE_MS].len(),
        2,
        "the last read makes the closed bar complete"
    );
    assert_eq!(ticks[&0].len(), 1);
    assert!(feed.incomplete_bars().is_empty());
}

#[test]
fn a_live_read_that_stops_inside_the_closed_bar_leaves_it_without_a_footprint() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let start = Instant::now();
    let opening = feed.follow_forming_bar(forming(0), start, PAGE_BOUND);
    assert!(opening.page.is_some(), "the forming bar's read");

    let closed_at = start + Duration::from_millis(200);
    let closing = feed.follow_forming_bar(forming(MINUTE_MS), closed_at, PAGE_BOUND);
    assert!(closing.page.is_some(), "the closed bar's last read");

    feed.accept_live_page(
        answered(
            &[
                wire_tick(0, "100", "1", TICK_FLAG_BUY),
                wire_tick(0, "100", "1", TICK_FLAG_BUY),
            ],
            false,
        ),
        PAGE_BOUND,
    );

    assert!(feed.complete_ticks().is_empty());
    assert_eq!(feed.incomplete_bars(), &[0]);
}

#[test]
fn a_page_of_a_dropped_read_is_idle() {
    let mut feed = FootprintFeed::default();

    assert_eq!(
        feed.accept_page(answered(&[], true), PAGE_BOUND),
        PageOutcome::Idle,
        "a feed told to forget its window ignores the answer"
    );
    assert_eq!(
        feed.accept_live_page(answered(&[], true), PAGE_BOUND),
        PageOutcome::Idle,
        "a feed with no live read ignores the answer"
    );
}

#[test]
fn a_chart_without_a_window_follows_no_forming_bar() {
    let mut feed = FootprintFeed::default();

    let step = feed.follow_forming_bar(forming(MINUTE_MS), Instant::now(), PAGE_BOUND);

    assert_eq!(step.page, None, "no window, no forming bar to read");
    assert!(!step.ticks_dropped);
}

#[test]
fn a_page_that_brings_no_tick_is_not_a_read_of_the_bar() {
    let mut read = FootprintTicks::new(one_minute(0), WIDE_BUDGET).expect("a one-bar window");
    read.next_page(PAGE_BOUND).expect("the bar's page");

    read.accept(answered(&[], false));
    let kept = read.finish();

    assert!(kept.ticks.is_empty());
    assert_eq!(
        kept.incomplete, None,
        "an empty page leaves nothing half read"
    );
}

#[test]
fn a_live_read_costs_one_page_while_it_fits() {
    let mut feed = FootprintFeed::default();
    feed.start(one_minute(0), PAGE_BOUND)
        .expect("the window's page");

    let step = feed.follow_forming_bar(forming(MINUTE_MS), Instant::now(), PAGE_BOUND);
    let page = step.page.expect("the forming bar's read");

    assert_eq!(
        page,
        TickPage {
            first_bar: 0,
            from_ms: MINUTE_MS,
            to_ms: 2 * MINUTE_MS,
            max_ticks: PAGE_BOUND,
        },
        "the live read is a one-bar window"
    );
}

#[test]
fn a_quote_tick_trades_at_the_mid_price_and_the_bid_stands_in_without_an_ask() {
    let quote = MarketTick {
        bid: "25657.69".to_string(),
        ask: "25658.99".to_string(),
        last: "0".to_string(),
        ..wire_tick(1, "0", "0", 0)
    };
    assert_eq!(
        to_trade_tick(&quote).map(|trade| trade.price),
        Some(dec("25658.34")),
        "a tick without a last price trades between its bid and its ask"
    );
    let bid_only = MarketTick {
        ask: "0".to_string(),
        ..quote.clone()
    };
    assert_eq!(
        to_trade_tick(&bid_only).map(|trade| trade.price),
        Some(dec("25657.69")),
        "without an ask the bid names the price"
    );
}

#[test]
fn a_tick_flagged_both_ways_converts_with_no_side_of_its_own() {
    let tick = wire_tick(1, "1.5", "0", 2 | 4 | TICK_FLAG_BUY | TICK_FLAG_SELL);
    assert_eq!(
        to_trade_tick(&tick).map(|trade| trade.side),
        Some(TickSide::Unknown)
    );
}
