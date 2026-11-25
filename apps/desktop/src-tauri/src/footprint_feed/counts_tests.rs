use super::counts::level_ticks;
use super::{BarSpan, CountsLive, CountsPage, CountsRead};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use trading_core::footprint::{FootprintTick, TickSide};
use trading_core::protocol::{
    FootprintBarCounts, FootprintCarry, FootprintLevel, FootprintSide, TickFootprintHistorySnapshot,
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
/// volume and no tick count.
fn bar_at(minute: i64) -> BarSpan {
    BarSpan {
        open_ms: minute * MINUTE_MS,
        end_ms: (minute + 1) * MINUTE_MS,
        tick_volume: 0,
        real_volume: false,
    }
}

/// `count` minute bars opening from minute zero, oldest first, whose candles reported no tick count: a
/// page cannot be sized from them, so each is read alone.
fn minutes(count: i64) -> Vec<BarSpan> {
    (0..count).map(bar_at).collect()
}

/// The bar opening at minute `minute`, whose candle counted `tick_volume` ticks.
fn counted_bar(minute: i64, tick_volume: u64) -> BarSpan {
    BarSpan {
        tick_volume,
        ..bar_at(minute)
    }
}

/// One minute bar per entry of `counts`, opening from minute zero, each with its candle's tick count.
fn counted_minutes(counts: &[u64]) -> Vec<BarSpan> {
    counts
        .iter()
        .zip(0i64..)
        .map(|(count, minute)| counted_bar(minute, *count))
        .collect()
}

/// The opens of `bars`, oldest first.
fn opens(bars: &[BarSpan]) -> Vec<i64> {
    bars.iter().map(|bar| bar.open_ms).collect()
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

/// The trades the levels of an unweighted page sum to: one per unit of their sides' volumes. A side
/// the test spells as no number, to check that the read skips it, counts none.
fn counted_trades(levels: &[FootprintLevel]) -> u32 {
    levels
        .iter()
        .map(|level| side_trades(&level.buy) + side_trades(&level.sell))
        .sum()
}

/// The whole trades one side's text names, or none when it names no whole number.
fn side_trades(text: &str) -> u32 {
    text.parse::<u32>().unwrap_or(0)
}

/// The wire entry of one bar of a multi-bar page: the open the page counted into it and its levels.
fn bar_counts(open_ms: i64, texts: &[(&str, &str, &str)]) -> FootprintBarCounts {
    let levels: Vec<FootprintLevel> = texts.iter().map(|text| wire_level(*text)).collect();
    FootprintBarCounts {
        open_ms,
        trade_ticks: counted_trades(&levels),
        levels,
    }
}

/// The answer to `page`: `through_ms` is where the EA stopped, `texts` are the `(price, buy, sell)`
/// levels it counted at the page's top level — the shape a page of one bar answers with — and `carry`
/// the tick rule's state after them. The loaded and counted tick totals are not what the read folds, so
/// they stay at the level count.
fn answer(
    page: &CountsPage,
    complete: bool,
    through_ms: i64,
    texts: &[(&str, &str, &str)],
    carry: Option<FootprintCarry>,
) -> TickFootprintHistorySnapshot {
    let levels: Vec<FootprintLevel> = texts.iter().map(|text| wire_level(*text)).collect();
    let counted = counted_trades(&levels);
    TickFootprintHistorySnapshot {
        request_id: "rust-footprint-counts-1".to_owned(),
        symbol: SYMBOL.to_owned(),
        from_ms: page.from_ms,
        to_ms: page.to_ms(),
        tick_size: "0.1".to_owned(),
        complete,
        through_ms,
        loaded_ticks: counted,
        trade_ticks: counted,
        carry,
        levels,
        bars: Vec::new(),
    }
}

/// One level as `(price, buy, sell)` texts.
type LevelTexts<'a> = (&'a str, &'a str, &'a str);
/// One bar's open and its levels as texts.
type BarTexts<'a> = (i64, &'a [LevelTexts<'a>]);

/// The answer to the multi-bar `page`: one entry per `(open_ms, levels)` of `texts`, so a bar the
/// answer leaves out counted no trade, and the page's own levels stay empty.
fn bars_answer(
    page: &CountsPage,
    complete: bool,
    through_ms: i64,
    texts: &[BarTexts<'_>],
    carry: Option<FootprintCarry>,
) -> TickFootprintHistorySnapshot {
    let bars: Vec<FootprintBarCounts> = texts
        .iter()
        .map(|(open_ms, levels)| bar_counts(*open_ms, levels))
        .collect();
    let counted = bars
        .iter()
        .map(|bar| bar.trade_ticks)
        .fold(0, u32::saturating_add);
    TickFootprintHistorySnapshot {
        request_id: "rust-footprint-counts-1".to_owned(),
        symbol: SYMBOL.to_owned(),
        from_ms: page.from_ms,
        to_ms: page.to_ms(),
        tick_size: "0.1".to_owned(),
        complete,
        through_ms,
        loaded_ticks: counted,
        trade_ticks: counted,
        carry,
        levels: Vec::new(),
        bars,
    }
}

/// `page` answered whole, with `texts` as its `(price, buy, sell)` levels.
fn whole(page: &CountsPage, texts: &[(&str, &str, &str)]) -> TickFootprintHistorySnapshot {
    answer(page, true, page.to_ms(), texts, None)
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
fn a_page_covers_the_newest_run_of_bars_its_tick_counts_fit() {
    // Four bars whose candles counted two ticks each: two of them are five records widened by a quarter
    // and three are seven, so a page of six records covers the newest two bars.
    let bars = counted_minutes(&[2, 2, 2, 2]);
    let mut read = CountsRead::new(bars, WIDE_PAGES).expect("four bars");

    let newest = read.next_page(6).expect("the newest run's page");
    assert_eq!(opens(&newest.bars), vec![2 * MINUTE_MS, 3 * MINUTE_MS]);
    assert_eq!(
        (newest.from_ms, newest.to_ms()),
        (2 * MINUTE_MS, 4 * MINUTE_MS)
    );
    read.accept(&bars_answer(
        &newest,
        true,
        newest.to_ms(),
        &[
            (2 * MINUTE_MS, &[("100", "1", "0")]),
            (3 * MINUTE_MS, &[("100", "0", "1")]),
        ],
        None,
    ));
    assert_eq!(
        read.take_whole_bars().keys().copied().collect::<Vec<_>>(),
        vec![2 * MINUTE_MS, 3 * MINUTE_MS],
        "every bar of a complete page is whole"
    );

    let rest = read.next_page(6).expect("the bars under them");
    assert_eq!(opens(&rest.bars), vec![0, MINUTE_MS]);
    assert_eq!((rest.from_ms, rest.to_ms()), (0, 2 * MINUTE_MS));
}

#[test]
fn a_bar_whose_candle_counted_no_tick_is_read_alone() {
    // No estimate can size a page from a bar without a tick count: the newest one is asked for on its
    // own, and the bars under it are planned from their own counts once it is whole.
    let mut read = CountsRead::new(counted_minutes(&[2, 2, 0]), WIDE_PAGES).expect("three bars");

    let alone = read.next_page(PAGE_TICKS).expect("the newest bar's page");
    assert_eq!(opens(&alone.bars), vec![2 * MINUTE_MS]);
    read.accept(&whole(&alone, &[("100", "1", "0")]));

    let run = read.next_page(PAGE_TICKS).expect("the bars under it");
    assert_eq!(
        opens(&run.bars),
        vec![0, MINUTE_MS],
        "both counted bars fit one page"
    );
}

#[test]
fn a_bar_counted_under_another_real_volume_rule_is_read_alone() {
    let mut bars = counted_minutes(&[2, 2]);
    bars[1].real_volume = true;
    let mut read = CountsRead::new(bars, WIDE_PAGES).expect("two bars");

    let newest = read.next_page(PAGE_TICKS).expect("the newest bar's page");
    assert_eq!(opens(&newest.bars), vec![MINUTE_MS]);
    assert!(newest.real_volume, "one request carries one rule");
    read.accept(&whole(&newest, &[("100", "1", "0")]));

    let older = read.next_page(PAGE_TICKS).expect("the bar under it");
    assert_eq!(opens(&older.bars), vec![0]);
    assert!(!older.real_volume);
}

#[test]
fn a_bar_whose_count_exceeds_the_page_bound_is_asked_for_alone() {
    let mut read = CountsRead::new(counted_minutes(&[2, 1000]), WIDE_PAGES).expect("two bars");

    let page = read.next_page(10).expect("the newest bar's page");

    assert_eq!(
        opens(&page.bars),
        vec![MINUTE_MS],
        "at least one bar, whatever the estimate"
    );
}

#[test]
fn a_read_asks_for_the_newest_runs_first_and_hands_each_bar_out_once() {
    let mut read = CountsRead::new(minutes(3), WIDE_PAGES).expect("three bars are a window");

    let newest = read.next_page(PAGE_TICKS).expect("the newest bar's page");
    assert_eq!(opens(&newest.bars), vec![2 * MINUTE_MS]);
    assert_eq!(
        (newest.from_ms, newest.to_ms()),
        (2 * MINUTE_MS, 3 * MINUTE_MS)
    );
    assert_eq!(newest.carry, None, "a bar starts a fresh range");
    assert!(!newest.real_volume);

    read.accept(&whole(&newest, &[("100", "2", "1")]));

    let middle = read.next_page(PAGE_TICKS).expect("the bar under it");
    assert_eq!(opens(&middle.bars), vec![MINUTE_MS]);
    assert_eq!((middle.from_ms, middle.to_ms()), (MINUTE_MS, 2 * MINUTE_MS));
    read.accept(&whole(&middle, &[("100", "1", "0")]));

    let oldest = read.next_page(PAGE_TICKS).expect("the oldest bar");
    assert_eq!(oldest.bars.first().map(|bar| bar.open_ms), Some(0));
    read.accept(&whole(&oldest, &[("100", "0", "1")]));

    assert_eq!(read.next_page(PAGE_TICKS), None, "every bar is read");
    let kept = read.take_whole_bars();
    assert_eq!(kept.len(), 3, "each finished bar is handed out");
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![0, MINUTE_MS, 2 * MINUTE_MS]
    );
}

#[test]
fn a_multi_bar_page_lists_the_opens_after_its_first_bar_and_where_its_range_starts() {
    let mut read = CountsRead::new(counted_minutes(&[2, 2, 2]), WIDE_PAGES).expect("three bars");

    let page = read.next_page(PAGE_TICKS).expect("the run of three");
    let request = page.request(SYMBOL, PAGE_TICKS);

    assert_eq!(
        (request.history.from_ms, request.history.to_ms),
        (0, 3 * MINUTE_MS)
    );
    assert_eq!(
        request.bar_opens,
        vec![MINUTE_MS, 2 * MINUTE_MS],
        "every open after the first bar's"
    );
    assert_eq!(
        request.first_open_ms,
        Some(0),
        "the open the range starts in"
    );
    assert_eq!(request.validate(), Ok(()), "a request the wire accepts");
}

#[test]
fn a_single_bar_page_keeps_the_request_shape_of_one_bar() {
    let mut read = CountsRead::new(minutes(1), WIDE_PAGES).expect("a one-bar window");

    let page = read.next_page(PAGE_TICKS).expect("the bar's page");
    let request = page.request(SYMBOL, PAGE_TICKS);

    assert!(request.bar_opens.is_empty());
    assert_eq!(request.first_open_ms, None);
    assert_eq!(
        (request.history.from_ms, request.history.to_ms),
        (0, MINUTE_MS)
    );
}

#[test]
fn a_complete_page_hands_every_bar_it_lists_whole() {
    let mut read = CountsRead::new(counted_minutes(&[2, 2, 2]), WIDE_PAGES).expect("three bars");
    let page = read.next_page(PAGE_TICKS).expect("the run of three");

    // The answer names the first and the third bar only: a bar it leaves out counted no trade, so it is
    // whole with no trades and no ticks.
    read.accept(&bars_answer(
        &page,
        true,
        page.to_ms(),
        &[
            (0, &[("100", "2", "1")]),
            (2 * MINUTE_MS, &[("101", "0", "3")]),
        ],
        None,
    ));

    let kept = read.take_whole_bars();
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![0, MINUTE_MS, 2 * MINUTE_MS]
    );
    assert_eq!(
        kept[&0],
        vec![
            trade(0, "100", "2", TickSide::Buy),
            trade(0, "100", "1", TickSide::Sell),
        ]
    );
    assert!(kept[&MINUTE_MS].is_empty(), "a bar absent from the answer");
    assert_eq!(
        kept[&(2 * MINUTE_MS)],
        vec![trade(2 * MINUTE_MS, "101", "3", TickSide::Sell)]
    );
    assert_eq!(read.next_page(PAGE_TICKS), None, "every bar is read");
}

#[test]
fn an_incomplete_page_hands_out_the_bars_before_the_one_it_stopped_in_and_continues_it() {
    let mut read = CountsRead::new(counted_minutes(&[2, 2, 2]), WIDE_PAGES).expect("three bars");
    let first = read.next_page(PAGE_TICKS).expect("the run of three");
    let given = Some(carry("101", FootprintSide::Sell));

    // The page counted the oldest bar whole and stopped inside the middle one, which is the last bar it
    // counted a trade into.
    read.accept(&bars_answer(
        &first,
        false,
        MINUTE_MS + HALF_MINUTE_MS,
        &[(0, &[("100", "1", "0")]), (MINUTE_MS, &[("101", "2", "0")])],
        given.clone(),
    ));

    let kept = read.take_whole_bars();
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![0],
        "the bars before the one it stopped in"
    );
    assert_eq!(kept[&0], vec![trade(0, "100", "1", TickSide::Buy)]);

    let rest = read
        .next_page(PAGE_TICKS)
        .expect("the rest of the bar and the run after it");
    assert_eq!(opens(&rest.bars), vec![MINUTE_MS, 2 * MINUTE_MS]);
    assert_eq!(rest.to_ms(), 3 * MINUTE_MS);
    assert_eq!(rest.from_ms, MINUTE_MS + HALF_MINUTE_MS);
    assert_eq!(
        rest.carry, given,
        "the carry its last counted bar left, which is the bar it continues"
    );
    let request = rest.request(SYMBOL, PAGE_TICKS);
    assert_eq!(
        request.history.from_ms,
        MINUTE_MS + HALF_MINUTE_MS,
        "the millisecond the page reached"
    );
    assert_eq!(
        request.first_open_ms,
        Some(MINUTE_MS),
        "the open of the bar the range starts in"
    );
    assert_eq!(
        request.bar_opens,
        vec![2 * MINUTE_MS],
        "only the opens after that bar"
    );
    assert_eq!(request.validate(), Ok(()), "a request the wire accepts");

    // The rest of the run answers whole and adds to the levels the page before it counted.
    read.accept(&bars_answer(
        &rest,
        true,
        rest.to_ms(),
        &[
            (MINUTE_MS, &[("101", "1", "0")]),
            (2 * MINUTE_MS, &[("102", "0", "2")]),
        ],
        None,
    ));
    let kept = read.take_whole_bars();
    assert_eq!(
        kept.keys().copied().collect::<Vec<_>>(),
        vec![MINUTE_MS, 2 * MINUTE_MS]
    );
    assert_eq!(
        kept[&MINUTE_MS],
        vec![trade(MINUTE_MS, "101", "3", TickSide::Buy)],
        "a price counted on two pages is one level whose sides sum"
    );
    assert_eq!(
        kept[&(2 * MINUTE_MS)],
        vec![trade(2 * MINUTE_MS, "102", "2", TickSide::Sell)]
    );
    assert_eq!(read.next_page(PAGE_TICKS), None, "every bar is read");
}

#[test]
fn a_continued_bar_starts_a_fresh_tick_rule_when_the_answer_ended_before_it() {
    let mut read = CountsRead::new(counted_minutes(&[2, 2]), WIDE_PAGES).expect("two bars");
    let page = read.next_page(PAGE_TICKS).expect("the run of two");
    let given = Some(carry("100", FootprintSide::Buy));

    // The page counted the oldest bar only: the bar it stopped in counted no trade yet, so its
    // continuation must not take the carry the last trade of the bar before it left.
    read.accept(&bars_answer(
        &page,
        false,
        MINUTE_MS + HALF_MINUTE_MS,
        &[(0, &[("100", "1", "0")])],
        given,
    ));

    let rest = read.next_page(PAGE_TICKS).expect("the rest of the bar");
    assert_eq!(opens(&rest.bars), vec![MINUTE_MS]);
    assert_eq!(
        rest.carry, None,
        "the answer's last counted bar is not this one"
    );
}

#[test]
fn a_page_carries_the_bar_s_real_volume_rule() {
    let bar = BarSpan {
        real_volume: true,
        ..bar_at(0)
    };
    let mut read = CountsRead::new(vec![bar], WIDE_PAGES).expect("a one-bar window");

    let page = read.next_page(PAGE_TICKS).expect("the bar's page");

    assert!(
        page.real_volume,
        "a bar with a real volume weighs its trades"
    );
}

#[test]
fn an_incomplete_page_continues_from_its_through_ms_with_its_carry() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let first = read.next_page(PAGE_TICKS).expect("the bar's page");
    let given = Some(carry("100", FootprintSide::Sell));

    read.accept(&partial(
        &first,
        HALF_MINUTE_MS,
        &[("100", "1", "2")],
        given,
    ));

    let rest = read.next_page(PAGE_TICKS).expect("the rest of the bar");
    assert_eq!(
        (rest.bars.first().map(|bar| bar.open_ms), rest.from_ms),
        (Some(0), HALF_MINUTE_MS)
    );
    assert_eq!(
        rest.to_ms(),
        MINUTE_MS,
        "the continuation ends at the bar's end"
    );
    assert_eq!(
        rest.carry,
        Some(carry("100", FootprintSide::Sell)),
        "the carry a page of one bar leaves"
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
    let first = read.next_page(PAGE_TICKS).expect("the bar's page");
    let given = Some(carry("101", FootprintSide::Buy));

    read.accept(&partial(
        &first,
        HALF_MINUTE_MS,
        &[("100", "1", "2"), ("101", "1", "0")],
        given,
    ));

    let rest = read.next_page(PAGE_TICKS).expect("the rest of the bar");
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
    let newest = read.next_page(PAGE_TICKS).expect("the newest bar's page");
    // The newer of the bars opening at 0 and a minute.
    let half_past = MINUTE_MS + HALF_MINUTE_MS;
    let given = Some(carry("100", FootprintSide::Buy));

    read.accept(&partial(&newest, half_past, &[("100", "1", "1")], given));

    let rest = read.next_page(PAGE_TICKS).expect("the rest of the bar");
    assert_eq!(rest.from_ms, half_past);
    let given = Some(carry("100", FootprintSide::Buy));
    read.accept(&partial(&rest, rest.from_ms, &[], given));

    assert_eq!(read.stopped_in(), Some(MINUTE_MS), "the bar stops the read");
    assert_eq!(
        read.next_page(PAGE_TICKS),
        None,
        "no page follows a stopped read"
    );
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

    let newest = read.next_page(PAGE_TICKS).expect("the first page");
    read.accept(&partial(&newest, half_past, &[("100", "1", "1")], given));
    let rest = read
        .next_page(PAGE_TICKS)
        .expect("the continuation is the second page");
    read.accept(&whole(&rest, &[("100", "1", "1")]));

    assert_eq!(
        read.next_page(PAGE_TICKS),
        None,
        "the read asked for its two pages"
    );
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
    let page = read.next_page(PAGE_TICKS).expect("the bar's page");
    let foreign = CountsPage {
        from_ms: page.from_ms + 1,
        ..page.clone()
    };

    read.accept(&answer(
        &foreign,
        true,
        foreign.to_ms(),
        &[("100", "1", "1")],
        None,
    ));

    assert!(read.take_whole_bars().is_empty(), "no bar of another page");
    assert_eq!(
        read.next_page(PAGE_TICKS),
        Some(page),
        "the page it planned is asked"
    );
}

#[test]
fn a_level_the_wire_does_not_spell_as_a_decimal_is_skipped() {
    let mut read = CountsRead::new(vec![bar_at(0)], WIDE_PAGES).expect("a one-bar window");
    let page = read.next_page(PAGE_TICKS).expect("the bar's page");
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
    assert_eq!(
        (first.bars.first().map(|bar| bar.open_ms), first.from_ms),
        (Some(MINUTE_MS), MINUTE_MS)
    );
    assert_eq!(first.to_ms(), 2 * MINUTE_MS);
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
        (rest.from_ms, rest.to_ms()),
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
        (rest.from_ms, rest.to_ms()),
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
        from_ms: page.from_ms + 1,
        ..page.clone()
    };
    live.accept(&answer(
        &foreign,
        true,
        foreign.to_ms(),
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
        bars: vec![bar_at(2)],
        from_ms: 2 * MINUTE_MS + HALF_MINUTE_MS,
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
