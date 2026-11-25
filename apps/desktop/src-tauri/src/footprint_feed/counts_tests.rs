use super::counts::level_ticks;
use super::{BarSpan, CountsLive, CountsPage, CountsRead};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use trading_core::footprint::{FootprintTick, TickSide};
use trading_core::protocol::{
    FootprintCarry, FootprintLevel, FootprintSide, TickFootprintHistorySnapshot,
};

const MINUTE_MS: i64 = 60_000;
/// The millisecond halfway through a bar: where a page of these tests stops when it does not hold its
/// bar's whole range.
const HALF_MINUTE_MS: i64 = MINUTE_MS / 2;
/// Pages a read of these tests may ask for where the limit is not what the test checks.
const WIDE_PAGES: usize = 10;
/// Ticks a page of these tests asks for, within the negotiated page bound.
const PAGE_TICKS: u32 = 500;
/// The symbol the requests of these tests are written for.
const SYMBOL: &str = "NAS100";

/// The decimal `value` names.
fn dec(value: &str) -> Decimal {
    value.parse().expect("a decimal")
}

/// The bar opening at minute `minute` of a test's window, a minute long, whose candle reported no real
/// volume.
fn bar_at(minute: i64) -> BarSpan {
    BarSpan {
        open_ms: minute * MINUTE_MS,
        end_ms: (minute + 1) * MINUTE_MS,
        tick_volume: 0,
        real_volume: false,
    }
}

/// `count` minute bars opening from minute zero, oldest first.
fn minutes(count: i64) -> Vec<BarSpan> {
    (0..count).map(bar_at).collect()
}

/// One counted trade of the bar opening at `open_ms`.
fn trade(open_ms: i64, price: &str, volume: &str, side: TickSide) -> FootprintTick {
    FootprintTick {
        time_ms: open_ms,
        price: dec(price),
        volume: dec(volume),
        side,
    }
}

/// The wire level a `(price, buy, sell)` text triple names.
fn wire_level((price, buy, sell): (&str, &str, &str)) -> FootprintLevel {
    FootprintLevel {
        price: price.to_owned(),
        buy: buy.to_owned(),
        sell: sell.to_owned(),
    }
}

/// The tick-rule state `price` and `side` name.
fn carry(price: &str, side: FootprintSide) -> FootprintCarry {
    FootprintCarry {
        price: price.to_owned(),
        side,
    }
}

/// The answer to `page`: `through_ms` is where the EA stopped, `texts` are the `(price, buy, sell)`
/// levels it counted and `carry` the tick rule's state after them. The loaded and counted tick totals
/// are not what the read folds, so they stay at the level count.
fn answer(
    page: &CountsPage,
    complete: bool,
    through_ms: i64,
    texts: &[(&str, &str, &str)],
    carry: Option<FootprintCarry>,
) -> TickFootprintHistorySnapshot {
    let levels: Vec<FootprintLevel> = texts.iter().map(|text| wire_level(*text)).collect();
    let counted = u32::try_from(levels.len()).expect("a test's level count fits a u32");
    TickFootprintHistorySnapshot {
        request_id: "rust-footprint-counts-1".to_owned(),
        symbol: SYMBOL.to_owned(),
        from_ms: page.from_ms,
        to_ms: page.to_ms,
        tick_size: "0.1".to_owned(),
        complete,
        through_ms,
        loaded_ticks: counted,
        trade_ticks: counted,
        carry,
        levels,
    }
}

/// `page` answered whole, with `texts` as its `(price, buy, sell)` levels.
fn whole(page: &CountsPage, texts: &[(&str, &str, &str)]) -> TickFootprintHistorySnapshot {
    answer(page, true, page.to_ms, texts, None)
}

/// `page` answered up to `through_ms` only, with its levels and the tick rule's state after them.
fn partial(
    page: &CountsPage,
    through_ms: i64,
    texts: &[(&str, &str, &str)],
    carry: Option<FootprintCarry>,
) -> TickFootprintHistorySnapshot {
    answer(page, false, through_ms, texts, carry)
}

#[test]
fn a_window_without_bars_is_no_read() {
    assert!(CountsRead::new(Vec::new(), WIDE_PAGES).is_none());
}

#[test]
fn a_read_asks_for_the_newest_bar_first_and_one_bar_at_a_time() {
    let mut read = CountsRead::new(minutes(3), WIDE_PAGES).expect("three bars are a window");

    let newest = read.next_page().expect("the newest bar's page");
    assert_eq!(newest.open_ms, 2 * MINUTE_MS);
    assert_eq!(
        (newest.from_ms, newest.to_ms),
        (2 * MINUTE_MS, 3 * MINUTE_MS)
    );
    assert_eq!(newest.carry, None, "a bar starts a fresh range");
    assert!(!newest.real_volume);

    read.accept(&whole(&newest, &[("100", "2", "1")]));

    let middle = read.next_page().expect("the bar under it");
    assert_eq!(middle.open_ms, MINUTE_MS, "one bar per page, newest first");
    assert_eq!((middle.from_ms, middle.to_ms), (MINUTE_MS, 2 * MINUTE_MS));
    read.accept(&whole(&middle, &[("100", "1", "0")]));

    let oldest = read.next_page().expect("the oldest bar");
    assert_eq!(oldest.open_ms, 0);
    read.accept(&whole(&oldest, &[("100", "0", "1")]));

    assert_eq!(read.next_page(), None, "every bar is read");
    let kept = read.take_whole_bars();
    assert_eq!(kept.len(), 3, "each finished bar is handed out");
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![0, MINUTE_MS, 2 * MINUTE_MS]
    );
}

#[test]
fn a_page_carries_the_bar_s_real_volume_rule() {
    let bar = BarSpan {
        real_volume: true,
        ..bar_at(0)
    };
    let mut read = CountsRead::new(vec![bar], WIDE_PAGES).expect("a one-bar window");

    let page = read.next_page().expect("the bar's page");

    assert!(
        page.real_volume,
        "a bar with a real volume weighs its trades"
    );
}

#[test]
fn an_incomplete_page_continues_from_its_through_ms_with_its_carry() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let first = read.next_page().expect("the bar's page");
    let given = Some(carry("100", FootprintSide::Sell));

    read.accept(&partial(
        &first,
        HALF_MINUTE_MS,
        &[("100", "1", "2")],
        given,
    ));

    let rest = read.next_page().expect("the rest of the bar");
    assert_eq!((rest.open_ms, rest.from_ms), (0, HALF_MINUTE_MS));
    assert_eq!(
        rest.to_ms, MINUTE_MS,
        "the continuation ends at the bar's end"
    );
    assert_eq!(
        rest.carry,
        Some(carry("100", FootprintSide::Sell)),
        "the carry"
    );
    assert_eq!(
        read.stopped_in(),
        None,
        "a page that moved on leaves the bar"
    );
}

#[test]
fn a_bar_s_continuation_merges_into_the_levels_it_already_counted() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let first = read.next_page().expect("the bar's page");
    let given = Some(carry("101", FootprintSide::Buy));

    read.accept(&partial(
        &first,
        HALF_MINUTE_MS,
        &[("100", "1", "2"), ("101", "1", "0")],
        given,
    ));

    let rest = read.next_page().expect("the rest of the bar");
    read.accept(&whole(&rest, &[("100", "3", "0"), ("102", "0", "4")]));

    let kept = read.take_whole_bars();
    let ticks = &kept[&0];
    assert_eq!(kept.len(), 1, "one bar is handed out");
    assert_eq!(ticks.len(), 4, "one trade per level and side");
    assert_eq!(
        ticks[0],
        trade(0, "100", "4", TickSide::Buy),
        "the sides of a price sum"
    );
    assert_eq!(ticks[1], trade(0, "100", "2", TickSide::Sell));
    assert_eq!(ticks[2], trade(0, "101", "1", TickSide::Buy));
    assert_eq!(ticks[3], trade(0, "102", "4", TickSide::Sell));
}

#[test]
fn a_page_that_makes_no_progress_stops_its_bar_and_the_read() {
    let mut read = CountsRead::new(minutes(2), WIDE_PAGES).expect("two bars are a window");
    let newest = read.next_page().expect("the newest bar's page");
    // The newer of the bars opening at 0 and a minute.
    let half_past = MINUTE_MS + HALF_MINUTE_MS;
    let given = Some(carry("100", FootprintSide::Buy));

    read.accept(&partial(&newest, half_past, &[("100", "1", "1")], given));

    let rest = read.next_page().expect("the rest of the bar");
    assert_eq!(rest.from_ms, half_past);
    let given = Some(carry("100", FootprintSide::Buy));
    read.accept(&partial(&rest, rest.from_ms, &[], given));

    assert_eq!(read.stopped_in(), Some(MINUTE_MS), "the bar stops the read");
    assert_eq!(read.next_page(), None, "no page follows a stopped read");
    assert!(
        read.take_whole_bars().is_empty(),
        "a stopped bar keeps no ticks"
    );
}

#[test]
fn a_read_asks_for_no_more_pages_than_its_limit() {
    let mut read = CountsRead::new(minutes(3), 2).expect("three bars are a window");
    let half_past = 2 * MINUTE_MS + HALF_MINUTE_MS;
    let given = Some(carry("100", FootprintSide::Buy));

    let newest = read.next_page().expect("the first page");
    read.accept(&partial(&newest, half_past, &[("100", "1", "1")], given));
    let rest = read
        .next_page()
        .expect("the continuation is the second page");
    read.accept(&whole(&rest, &[("100", "1", "1")]));

    assert_eq!(read.next_page(), None, "the read asked for its two pages");
    let kept = read.take_whole_bars();
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![2 * MINUTE_MS]
    );
    assert_eq!(read.stopped_in(), None, "the limit stops between bars");
}

#[test]
fn an_answer_for_another_page_is_ignored() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let page = read.next_page().expect("the bar's page");
    let foreign = CountsPage {
        from_ms: page.from_ms + 1,
        ..page.clone()
    };

    read.accept(&answer(
        &foreign,
        true,
        foreign.to_ms,
        &[("100", "1", "1")],
        None,
    ));

    assert!(read.take_whole_bars().is_empty(), "no bar of another page");
    assert_eq!(read.next_page(), Some(page), "the page it planned is asked");
}

#[test]
fn a_level_the_wire_does_not_spell_as_a_decimal_is_skipped() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let page = read.next_page().expect("the bar's page");
    let levels = [
        ("100", "1", "1"),
        ("not a price", "1", "0"),
        ("101", "oops", "1"),
    ];

    read.accept(&whole(&page, &levels));

    let kept = read.take_whole_bars();
    let ticks = &kept[&0];
    assert_eq!(ticks.len(), 2, "the rest of the page still counts");
    assert_eq!(ticks[0], trade(0, "100", "1", TickSide::Buy));
    assert_eq!(ticks[1], trade(0, "100", "1", TickSide::Sell));
}

#[test]
fn a_level_becomes_a_buy_tick_then_a_sell_tick_at_its_price() {
    let mut levels = BTreeMap::new();
    levels.insert(dec("101"), (dec("0"), dec("4")));
    levels.insert(dec("100"), (dec("2"), dec("3")));

    let ticks = level_ticks(7, &levels);

    assert_eq!(ticks.len(), 3);
    assert_eq!(
        ticks[0],
        trade(7, "100", "2", TickSide::Buy),
        "prices ascend"
    );
    assert_eq!(ticks[1], trade(7, "100", "3", TickSide::Sell));
    assert_eq!(ticks[2], trade(7, "101", "4", TickSide::Sell));
}

#[test]
fn a_level_that_traded_no_volume_names_no_tick() {
    let mut levels = BTreeMap::new();
    levels.insert(dec("100"), (dec("0"), dec("2")));
    levels.insert(dec("101"), (dec("3"), dec("0")));
    levels.insert(dec("102"), (dec("0"), dec("0")));

    let ticks = level_ticks(0, &levels);

    assert_eq!(ticks.len(), 2, "a side that traded nothing names no tick");
    assert_eq!(ticks[0], trade(0, "100", "2", TickSide::Sell));
    assert_eq!(ticks[1], trade(0, "101", "3", TickSide::Buy));
}

#[test]
fn a_live_read_asks_from_the_bar_s_open_and_then_from_where_it_stopped() {
    let mut live = CountsLive::new(bar_at(1), false);

    let first = live.next_page().expect("the bar's first page");
    assert_eq!((first.open_ms, first.from_ms), (MINUTE_MS, MINUTE_MS));
    assert_eq!(first.to_ms, 2 * MINUTE_MS);
    assert_eq!(first.carry, None);

    let given = Some(carry("100", FootprintSide::Buy));
    live.accept(&partial(
        &first,
        MINUTE_MS + HALF_MINUTE_MS,
        &[("100", "2", "0")],
        given,
    ));
    assert_eq!(
        live.ticks(),
        vec![trade(MINUTE_MS, "100", "2", TickSide::Buy)]
    );

    let rest = live.next_page().expect("the rest of the forming bar");
    assert_eq!(
        (rest.from_ms, rest.to_ms),
        (MINUTE_MS + HALF_MINUTE_MS, 2 * MINUTE_MS)
    );
    assert_eq!(
        rest.carry,
        Some(carry("100", FootprintSide::Buy)),
        "the carry"
    );
}

#[test]
fn a_forming_read_that_reaches_the_end_is_not_whole_and_a_closing_one_is() {
    let mut forming = CountsLive::new(bar_at(0), false);
    let page = forming.next_page().expect("the forming bar's page");
    forming.accept(&whole(&page, &[("100", "1", "1")]));

    assert_eq!(forming.next_page(), None, "the read reached the bar's end");
    assert!(!forming.is_whole(), "a forming bar keeps gaining trades");

    let mut closing = CountsLive::new(bar_at(0), true);
    let page = closing.next_page().expect("the closed bar's page");
    closing.accept(&whole(&page, &[("100", "1", "1")]));

    assert!(closing.is_whole(), "a closing read that reached its end");
}

#[test]
fn a_forming_read_extends_to_a_later_broker_time() {
    let mut live = CountsLive::new(bar_at(0), false);
    let page = live.next_page().expect("the bar's page");
    live.accept(&whole(&page, &[("100", "1", "1")]));
    assert_eq!(live.next_page(), None);

    live.set_end(MINUTE_MS + HALF_MINUTE_MS);

    let rest = live.next_page().expect("the trades the bar gained since");
    assert_eq!(
        (rest.from_ms, rest.to_ms),
        (MINUTE_MS, MINUTE_MS + HALF_MINUTE_MS)
    );
    live.accept(&whole(&rest, &[("100", "2", "0")]));

    assert_eq!(live.next_page(), None);
    let ticks = live.ticks();
    assert_eq!(
        ticks.len(),
        2,
        "the pages merge into the levels counted before"
    );
    assert_eq!(ticks[0], trade(0, "100", "3", TickSide::Buy));
    assert_eq!(ticks[1], trade(0, "100", "1", TickSide::Sell));
}

#[test]
fn a_live_read_ignores_a_page_that_made_no_progress_or_another_bar_s_page() {
    let mut live = CountsLive::new(bar_at(0), false);
    let page = live.next_page().expect("the bar's page");
    let given = Some(carry("100", FootprintSide::Buy));

    live.accept(&partial(&page, page.from_ms, &[], given));
    assert!(live.ticks().is_empty(), "a page that certified no progress");
    assert_eq!(
        live.next_page(),
        Some(page.clone()),
        "the same page is asked"
    );

    let foreign = CountsPage {
        to_ms: page.to_ms + 1,
        ..page.clone()
    };
    live.accept(&answer(
        &foreign,
        true,
        foreign.to_ms,
        &[("100", "1", "1")],
        None,
    ));
    assert!(
        live.ticks().is_empty(),
        "a page of another range is not this read's"
    );

    live.accept(&whole(&page, &[("100", "1", "1")]));
    assert_eq!(live.ticks().len(), 2, "the read's own page still counts");
}

#[test]
fn a_page_asks_for_its_counts_over_its_range() {
    let page = CountsPage {
        open_ms: 2 * MINUTE_MS,
        from_ms: 2 * MINUTE_MS + HALF_MINUTE_MS,
        to_ms: 3 * MINUTE_MS,
        real_volume: true,
        carry: Some(carry("100.5", FootprintSide::Buy)),
    };

    let request = page.request(SYMBOL, PAGE_TICKS);

    assert_eq!(request.history.symbol, SYMBOL);
    assert_eq!(request.history.from_ms, 2 * MINUTE_MS + HALF_MINUTE_MS);
    assert_eq!(request.history.to_ms, 3 * MINUTE_MS);
    assert_eq!(request.history.max_ticks, PAGE_TICKS);
    assert!(request.footprint_counts, "the page counts trades per price");
    assert!(request.real_volume);
    assert_eq!(request.carry, Some(carry("100.5", FootprintSide::Buy)));
    assert_eq!(request.validate(), Ok(()), "a request the wire accepts");
}
