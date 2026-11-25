use super::*;
use crate::footprint::{TICK_FLAG_BUY, TICK_FLAG_SELL};

/// A price or a volume written as it reads, as a quote writes it.
fn decimal(text: &str) -> Decimal {
    text.parse().expect("a decimal literal")
}

/// A trade the feed flagged, at `price` with `volume`.
fn flagged(price: &str, volume: &str, side: TickSide) -> FootprintTick {
    FootprintTick {
        time_ms: 0,
        price: decimal(price),
        volume: decimal(volume),
        side,
    }
}

/// A tick the feed flagged neither way, so only the tick rule can tell its side; with no volume it
/// stands for the quote updates a real-volume instrument sends.
fn unflagged(price: &str, volume: &str) -> FootprintTick {
    FootprintTick {
        time_ms: 0,
        price: decimal(price),
        volume: decimal(volume),
        side: TickSide::Unknown,
    }
}

/// The price range a row spans.
fn prices(row: &FootprintRow) -> (Decimal, Decimal) {
    (row.down_price, row.up_price)
}

/// The `(buy, sell)` volume a row holds.
fn volumes(row: &FootprintRow) -> (Decimal, Decimal) {
    (row.buy_volume, row.sell_volume)
}

/// The `(buy, sell)` trades a row counted.
fn trades(mark: &RowMark) -> (u64, u64) {
    (mark.trades.buy, mark.trades.sell)
}

// Exact tick sizes: a half, a quarter, a cent and a tenth.
fn half_tick() -> Decimal {
    decimal("0.5")
}

fn quarter_tick() -> Decimal {
    decimal("0.25")
}

fn cent_tick() -> Decimal {
    decimal("0.01")
}

fn tenth_tick() -> Decimal {
    decimal("0.1")
}

/// Ticks per row that make one row as wide as the tick size.
const ONE_TICK_ROW: u32 = 1;
/// Ticks per row that make a row two half ticks wide.
const TWO_TICK_ROW: u32 = 2;
/// Ticks per row that make a row four quarter ticks wide, one price unit.
const FOUR_TICK_ROW: u32 = 4;
/// Ticks per row that make a row ten cents wide on a one-cent tick.
const TEN_TICK_ROW: u32 = 10;

#[test]
fn a_row_spans_ticks_per_row_times_the_tick_size() {
    // Two ticks per row with a half-unit tick make a row one price unit wide: 1.0 and 1.5 are ticks 2
    // and 3 of the row that starts at tick 2, and 2.5 is tick 5, one row higher.
    let ticks = [
        flagged("1.0", "2.0", TickSide::Buy),
        flagged("1.5", "1.0", TickSide::Buy),
        flagged("2.5", "3.0", TickSide::Sell),
    ];

    let rows = footprint_rows(&ticks, TWO_TICK_ROW, half_tick());

    assert_eq!(rows.len(), 2, "1.0 and 1.5 share a row, 2.5 has its own");
    assert_eq!(prices(&rows[0]), (decimal("1.0"), decimal("2.0")));
    assert_eq!(volumes(&rows[0]), (decimal("3.0"), decimal("0")));
    assert_eq!(prices(&rows[1]), (decimal("2.0"), decimal("3.0")));
    assert_eq!(volumes(&rows[1]), (decimal("0"), decimal("3.0")));
}

#[test]
fn a_flagged_tick_keeps_the_side_its_flag_names() {
    // The second trade is flagged a buy although it trades below the first, and the first is flagged a
    // sell although no price came before it: the flags win over the tick rule.
    let ticks = [
        flagged("2.0", "1.0", TickSide::Sell),
        flagged("1.0", "2.0", TickSide::Buy),
    ];

    let rows = footprint_rows(&ticks, 8, half_tick());

    assert_eq!(rows.len(), 1, "a row four price units wide holds both");
    assert_eq!(volumes(&rows[0]), (decimal("2.0"), decimal("1.0")));
}

#[test]
fn an_unflagged_tick_trades_by_the_tick_rule() {
    // Up from 1.0 to 1.5 is a buy, back down to 1.0 a sell, and the trade that stays at 1.0 keeps the
    // sell of the trade before it.
    let ticks = [
        unflagged("1.0", "1.0"),
        unflagged("1.5", "1.0"),
        unflagged("1.0", "1.0"),
        unflagged("1.0", "1.0"),
    ];

    let rows = footprint_rows(&ticks, 8, half_tick());

    assert_eq!(rows.len(), 1, "one row four price units wide");
    assert_eq!(volumes(&rows[0]), (decimal("2.0"), decimal("2.0")));
}

#[test]
fn the_first_unflagged_tick_of_a_bar_counts_as_a_buy() {
    let ticks = [unflagged("1.0", "3.0")];

    let rows = footprint_rows(&ticks, ONE_TICK_ROW, half_tick());

    assert_eq!(volumes(&rows[0]), (decimal("3.0"), decimal("0")));
}

#[test]
fn a_tick_without_a_volume_counts_as_one_trade() {
    // No tick of this set reports a volume, which is how a quote-only feed sends its trades, so each
    // tick counts as one trade: two buys and a sell in the one half-tick row that holds 1.0.
    let ticks = [
        flagged("1.0", "0", TickSide::Buy),
        flagged("1.0", "0", TickSide::Buy),
        flagged("1.0", "0", TickSide::Sell),
    ];

    let rows = footprint_rows(&ticks, ONE_TICK_ROW, half_tick());

    assert_eq!(volumes(&rows[0]), (decimal("2.0"), decimal("1.0")));
}

#[test]
fn a_row_counts_one_trade_per_tick_on_the_side_the_tick_took() {
    // One half-tick row per price, so 1.0 fills row 2 and 1.5 row 3. Two and a half lots in one tick is
    // still one trade: a row's trade counts are the ticks behind its volume, not the volume itself, and
    // the side each tick took is the side it counts on.
    let ticks = [
        flagged("1.0", "2.5", TickSide::Buy),
        flagged("1.0", "3.0", TickSide::Sell),
        flagged("1.5", "1.0", TickSide::Buy),
        flagged("1.5", "2.0", TickSide::Buy),
        flagged("1.5", "4.0", TickSide::Sell),
    ];

    let numbered = numbered_footprint_rows(&ticks, ONE_TICK_ROW, half_tick());

    let counted: Vec<(u64, u64)> = numbered.marks.iter().map(trades).collect();
    assert_eq!(counted, [(1, 1), (2, 1)], "one trade per tick, on its row");
    assert_eq!(volumes(&numbered.rows[0]), (decimal("2.5"), decimal("3.0")));
    assert_eq!(volumes(&numbered.rows[1]), (decimal("3.0"), decimal("4.0")));
    let buys: u64 = numbered.marks.iter().map(|mark| mark.trades.buy).sum();
    let sells: u64 = numbered.marks.iter().map(|mark| mark.trades.sell).sum();
    assert_eq!((buys, sells), (3, 2), "three buys and two sells");
}

#[test]
fn a_level_between_two_traded_rows_counts_no_trades() {
    // Rows one half tick wide: 1.0 fills row 2 and 2.0 row 4, so row 3 is the level between them that no
    // trade reached. It counts no trade on either side, as it moves no volume.
    let ticks = [
        flagged("1.0", "2.0", TickSide::Buy),
        flagged("2.0", "1.0", TickSide::Sell),
    ];

    let numbered = numbered_footprint_rows(&ticks, ONE_TICK_ROW, half_tick());

    let numbers: Vec<i64> = numbered.marks.iter().map(|mark| mark.number).collect();
    assert_eq!(numbers, [2, 3, 4]);
    let counted: Vec<(u64, u64)> = numbered.marks.iter().map(trades).collect();
    assert_eq!(counted, [(1, 0), (0, 0), (0, 1)]);
}

#[test]
fn a_set_with_a_volume_counts_only_the_ticks_that_report_one() {
    // Two lots bought at 1.00, a volume-less quote at 1.05 and three lots sold at 0.99. The quote
    // reports no volume although the set does, so it is a quote update and not a trade: it adds nothing
    // to the buy volume the tick rule would have given it.
    let mixed = [
        flagged("1.00", "2.0", TickSide::Buy),
        unflagged("1.05", "0"),
        flagged("0.99", "3.0", TickSide::Sell),
    ];

    let rows = footprint_rows(&mixed, ONE_TICK_ROW, half_tick());

    assert_eq!(rows.len(), 1, "one row of a half tick holds both trades");
    assert_eq!(volumes(&rows[0]), (decimal("2.0"), decimal("3.0")));

    // The quote never takes part in the tick rule either: 1.02 is above the 1.00 of the trade before it,
    // so it is a buy, although it is below the quote's 1.05, which would have sided it a sell.
    let above_the_trade_below_the_quote = [
        flagged("1.00", "2.0", TickSide::Buy),
        unflagged("1.05", "0"),
        unflagged("1.02", "3.0"),
    ];

    let rows = footprint_rows(&above_the_trade_below_the_quote, ONE_TICK_ROW, half_tick());

    assert_eq!(rows.len(), 1, "the next trade lands in the same row");
    assert_eq!(volumes(&rows[0]), (decimal("5.0"), decimal("0")));
}

#[test]
fn a_price_on_a_row_boundary_starts_its_own_row() {
    // The row of a price is its whole tick count divided by the row's width, so the cents between the
    // traded ones are rows of their own and the four cents between the first and the last traded rows
    // hold no volume.
    let cents = [
        flagged("1.10", "1.0", TickSide::Buy),
        flagged("1.15", "1.0", TickSide::Buy),
        flagged("1.20", "1.0", TickSide::Buy),
    ];

    let rows = footprint_rows(&cents, ONE_TICK_ROW, cent_tick());

    assert_eq!(
        rows.len(),
        11,
        "each tick from 110 to 120 is a row of its own"
    );
    assert_eq!(prices(&rows[0]), (decimal("1.10"), decimal("1.11")));
    assert_eq!(rows[5].down_price, decimal("1.15"));
    assert_eq!(prices(&rows[10]), (decimal("1.20"), decimal("1.21")));
    for empty in &rows[1..5] {
        assert_eq!(volumes(empty), (Decimal::ZERO, Decimal::ZERO));
    }
    assert_eq!(rows[5].buy_volume, decimal("1.0"));
    for empty in &rows[6..10] {
        assert_eq!(volumes(empty), (Decimal::ZERO, Decimal::ZERO));
    }

    // A tenth tick: a tenth and two tenths are the third tenth exactly, so the trade starts the row that
    // runs from 0.3 to 0.4.
    let tenths = [FootprintTick {
        time_ms: 0,
        price: decimal("0.1") + decimal("0.2"),
        volume: decimal("1.0"),
        side: TickSide::Buy,
    }];

    let rows = footprint_rows(&tenths, ONE_TICK_ROW, tenth_tick());

    assert_eq!(prices(&rows[0]), (decimal("0.3"), decimal("0.4")));
}

#[test]
fn a_price_a_tick_below_a_boundary_starts_the_row_below() {
    // Rows ten cents wide: tick 119 is one cent under the boundary at tick 120, so 1.19 shares the row
    // that 1.10 starts, which runs from 1.10 to 1.20.
    let in_one_row = [
        flagged("1.10", "1.0", TickSide::Buy),
        flagged("1.19", "2.0", TickSide::Buy),
    ];

    let rows = footprint_rows(&in_one_row, TEN_TICK_ROW, cent_tick());

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].buy_volume, decimal("3.0"));
    assert_eq!(prices(&rows[0]), (decimal("1.10"), decimal("1.20")));

    // Tick 109 is below that row's start, so 1.09 fills the row that runs from 1.00 to 1.10.
    let below = [flagged("1.09", "1.0", TickSide::Buy)];

    let rows = footprint_rows(&below, TEN_TICK_ROW, cent_tick());

    assert_eq!(prices(&rows[0]), (decimal("1.00"), decimal("1.10")));
}

#[test]
fn a_row_of_four_quarter_ticks_spans_one_price_unit() {
    // Ticks 1 and 3 fall in the row of ticks 0 to 4, and tick 4 starts the next row, so the rows span
    // [0.00, 1.00) and [1.00, 2.00).
    let ticks = [
        flagged("0.25", "1.0", TickSide::Buy),
        flagged("0.75", "2.0", TickSide::Sell),
        flagged("1.00", "3.0", TickSide::Buy),
    ];

    let rows = footprint_rows(&ticks, FOUR_TICK_ROW, quarter_tick());

    assert_eq!(rows.len(), 2);
    assert_eq!(prices(&rows[0]), (decimal("0"), decimal("1.0")));
    assert_eq!(volumes(&rows[0]), (decimal("1.0"), decimal("2.0")));
    assert_eq!(prices(&rows[1]), (decimal("1.0"), decimal("2.0")));
    assert_eq!(volumes(&rows[1]), (decimal("3.0"), decimal("0")));
}

#[test]
fn a_price_below_zero_floors_into_the_row_below() {
    // A row is four quarter ticks, one price unit. Tick -1 is a quarter below zero, so it belongs to the
    // row that ends at zero (row -1) rather than to row 0, and tick -5 floors to row -2, which spans
    // ticks -8 to -4, or -2.00 to -1.00.
    let ticks = [
        flagged("-0.25", "2.0", TickSide::Sell),
        flagged("-1.25", "1.0", TickSide::Buy),
    ];

    let rows = footprint_rows(&ticks, FOUR_TICK_ROW, quarter_tick());

    assert_eq!(rows.len(), 2, "row -2 comes before row -1");
    assert_eq!(prices(&rows[0]), (decimal("-2.0"), decimal("-1.0")));
    assert_eq!(volumes(&rows[0]), (decimal("1.0"), decimal("0")));
    assert_eq!(prices(&rows[1]), (decimal("-1.0"), decimal("0")));
    assert_eq!(volumes(&rows[1]), (decimal("0"), decimal("2.0")));
}

#[test]
fn a_gap_between_two_traded_rows_is_filled_with_empty_rows() {
    // Four quarter ticks make a row of one price unit. 0.0 is tick 0 of row 0 and 3.0 is tick 12, the
    // first tick of row 3, so rows 1 and 2 are levels between them that no trade reached. They are rows
    // all the same, empty on both sides: an imbalance is measured against the row right below a level,
    // and a skipped level would put that row two levels away.
    let ticks = [
        flagged("0", "2.0", TickSide::Buy),
        flagged("3.0", "1.0", TickSide::Sell),
    ];

    let rows = footprint_rows(&ticks, FOUR_TICK_ROW, quarter_tick());

    assert_eq!(rows.len(), 4, "rows 0, 1, 2 and 3 are all rows of the bar");
    for (number, row) in (0_i64..).zip(&rows) {
        assert_eq!(row.down_price, Decimal::from(number));
        assert_eq!(row.up_price, Decimal::from(number + 1));
    }
    assert_eq!(volumes(&rows[0]), (decimal("2.0"), decimal("0")));
    assert_eq!(volumes(&rows[1]), (Decimal::ZERO, Decimal::ZERO));
    assert_eq!(volumes(&rows[2]), (Decimal::ZERO, Decimal::ZERO));
    assert_eq!(volumes(&rows[3]), (decimal("0"), decimal("1.0")));
}

#[test]
fn a_price_between_two_ticks_snaps_to_the_nearest_one() {
    // A feed quotes no such price, so this only keeps a price that is not a multiple of the tick size
    // from landing in a row of its own: 1.014 is nearer tick 101 than tick 102, and 1.016 nearer tick
    // 102 than tick 101.
    let ticks = [
        flagged("1.014", "1.0", TickSide::Buy),
        flagged("1.016", "2.0", TickSide::Sell),
    ];

    let rows = footprint_rows(&ticks, ONE_TICK_ROW, cent_tick());

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].down_price, decimal("1.01"));
    assert_eq!(rows[1].down_price, decimal("1.02"));
}

#[test]
fn a_price_beyond_the_tick_grid_yields_no_row() {
    // A count of ticks beyond the whole numbers the grid holds names no row, like a price the symbol
    // could not have quoted, so the trade is dropped rather than rowed on its own.
    let far = [flagged("1000000000000000000", "1.0", TickSide::Buy)];
    assert!(footprint_rows(&far, ONE_TICK_ROW, decimal("0.0000000001")).is_empty());

    let highest = [flagged("1000000000000000000", "1.0", TickSide::Buy)];
    assert!(footprint_rows(&highest, ONE_TICK_ROW, cent_tick()).is_empty());

    // A count within the grid still rows, so the drop above is about the range and not about the
    // division being inexact.
    let countable = [flagged("9000000000000000", "1.0", TickSide::Buy)];
    assert_eq!(
        footprint_rows(&countable, ONE_TICK_ROW, Decimal::ONE).len(),
        1
    );
}

#[test]
fn a_widthless_row_or_a_priceless_trade_yields_no_rows() {
    let trade = flagged("1.0", "1.0", TickSide::Buy);

    assert!(footprint_rows(&[trade], ONE_TICK_ROW, Decimal::ZERO).is_empty());
    assert!(footprint_rows(&[trade], ONE_TICK_ROW, decimal("-0.5")).is_empty());
    assert!(footprint_rows(&[trade], 0, half_tick()).is_empty());
    assert!(footprint_rows(&[], ONE_TICK_ROW, half_tick()).is_empty());
}

#[test]
fn the_flags_name_the_side_the_feed_reports() {
    assert_eq!(TickSide::from_flags(TICK_FLAG_BUY), TickSide::Buy);
    assert_eq!(TickSide::from_flags(TICK_FLAG_SELL), TickSide::Sell);
    assert_eq!(TickSide::from_flags(0), TickSide::Unknown);
    assert_eq!(
        FootprintTick::from_flags(1_000, decimal("1.5"), decimal("2.0"), TICK_FLAG_SELL),
        FootprintTick {
            time_ms: 1_000,
            price: decimal("1.5"),
            volume: decimal("2.0"),
            side: TickSide::Sell,
        }
    );
}

/// MT5's flags of a quote tick on a feed that marks both sides on every tick: BID | ASK | BUY | SELL.
const BOTH_SIDES_QUOTE_FLAGS: u32 = 2 | 4 | TICK_FLAG_BUY | TICK_FLAG_SELL;

#[test]
fn a_tick_flagged_both_ways_names_no_side_and_the_tick_rule_decides_it() {
    assert_eq!(
        TickSide::from_flags(TICK_FLAG_BUY | TICK_FLAG_SELL),
        TickSide::Unknown
    );
    assert_eq!(
        TickSide::from_flags(BOTH_SIDES_QUOTE_FLAGS),
        TickSide::Unknown
    );
    // A falling price after the first trade: the tick rule makes the second a sell.
    let ticks = [
        FootprintTick::from_flags(1, decimal("2.0"), decimal("0"), BOTH_SIDES_QUOTE_FLAGS),
        FootprintTick::from_flags(2, decimal("1.0"), decimal("0"), BOTH_SIDES_QUOTE_FLAGS),
    ];
    let rows = footprint_rows(&ticks, ONE_TICK_ROW, half_tick());
    let sold: Decimal = rows.iter().map(|row| row.sell_volume).sum();
    let bought: Decimal = rows.iter().map(|row| row.buy_volume).sum();
    assert_eq!(
        (bought, sold),
        (decimal("1"), decimal("1")),
        "one uptick buy, one downtick sell"
    );
}
