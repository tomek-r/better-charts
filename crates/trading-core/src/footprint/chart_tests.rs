use super::*;
use crate::footprint::{FootprintTick, TickSide};

/// The bar every footprint in these tests belongs to.
const OPEN_MS: i64 = 1_700_000_000_000;

/// A price or a volume written as it reads.
fn decimal(text: &str) -> Decimal {
    text.parse().expect("a decimal literal")
}

/// A one-cent tick size.
fn cent_tick() -> Decimal {
    decimal("0.01")
}

/// A quarter-unit tick size.
fn quarter_tick() -> Decimal {
    decimal("0.25")
}

/// The share of the volume the value area covers by default, in percent.
fn default_va_percent() -> Decimal {
    Decimal::from(70)
}

/// A share no row of these tests reaches an imbalance at, so a flagged imbalance is always one the test
/// asked for.
fn never_an_imbalance() -> Decimal {
    Decimal::from(1_000)
}

/// Settings that split a bar into rows of ten ticks.
fn ten_tick_rows(imbalance_percent: Decimal) -> FootprintSettings {
    FootprintSettings {
        ticks_per_row: 10,
        va_percent: default_va_percent(),
        imbalance_percent,
    }
}

/// A trade the feed flagged a buy, at `price` with `volume`.
fn buy(price: &str, volume: &str) -> FootprintTick {
    FootprintTick {
        time_ms: OPEN_MS,
        price: decimal(price),
        volume: decimal(volume),
        side: TickSide::Buy,
    }
}

/// A trade the feed flagged a sell, at `price` with `volume`.
fn sell(price: &str, volume: &str) -> FootprintTick {
    FootprintTick {
        time_ms: OPEN_MS,
        price: decimal(price),
        volume: decimal(volume),
        side: TickSide::Sell,
    }
}

#[test]
fn a_row_reports_the_ticks_its_prices_and_volume_come_from() {
    // Ten one-cent ticks make a row of 0.10. The trades sit at tick 110 (1.10, row 11), tick 115 (1.15,
    // still row 11 because 115 / 10 floors to 11) and tick 120 (1.20, row 12). Row 11 therefore runs
    // from 1.10 to 1.20, and row 12 from 1.20 to 1.30.
    let ticks = [buy("1.10", "2.0"), sell("1.15", "1.0"), buy("1.20", "4.0")];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("three trades fill two rows");

    assert_eq!(bar.open_ms, OPEN_MS);
    assert_eq!(bar.volume, FootprintVolume::Real, "every tick has a volume");
    // Row 11 holds 2 bought and 1 sold, row 12 holds 4 bought, so the bar has 6 bought and 1 sold.
    assert_eq!(
        (bar.buy_volume, bar.sell_volume),
        (decimal("6.0"), decimal("1.0"))
    );
    assert_eq!(bar.rows.len(), 2, "one row per price range reached");

    let lower = &bar.rows[0];
    assert_eq!(lower.row, 11);
    assert_eq!(lower.down_price, decimal("1.10"));
    assert_eq!(lower.up_price, decimal("1.20"));
    assert_eq!(
        (lower.buy_volume, lower.sell_volume),
        (decimal("2.0"), decimal("1.0"))
    );

    let upper = &bar.rows[1];
    assert_eq!(upper.row, 12);
    assert_eq!(upper.down_price, decimal("1.20"));
    assert_eq!(upper.up_price, decimal("1.30"));
    assert_eq!(
        (upper.buy_volume, upper.sell_volume),
        (decimal("4.0"), decimal("0"))
    );

    // 4 in row 12 beats 3 in row 11, and the value area of 70% of 7 is 4.9: the POC row's 4 alone does
    // not cover it, so the value area takes the row below as well and spans both.
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(12), Some(12), Some(11)));
    // 4 bought against 1 sold is nowhere near the ten times this percentage asks for.
    assert!(!lower.buy_imbalance && !lower.sell_imbalance);
    assert!(!upper.buy_imbalance && !upper.sell_imbalance);
}

#[test]
fn an_imbalance_is_read_beside_the_row_below_and_above_it() {
    // Row 11 sells 1 at tick 115 and row 12 buys 10 at tick 125. At the 100% of these settings the upper
    // row's buy volume is ten times the sell volume below it, while the lower row's 1 is nowhere near the
    // 10 bought above it.
    let ticks = [sell("1.15", "1.0"), buy("1.25", "10.0")];
    let settings = ten_tick_rows(Decimal::from(100));

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("two trades fill two rows");

    assert_eq!(bar.rows.len(), 2);
    assert!(!bar.rows[0].buy_imbalance, "nothing below row 11");
    assert!(!bar.rows[0].sell_imbalance);
    assert!(bar.rows[1].buy_imbalance);
    assert!(!bar.rows[1].sell_imbalance, "nothing above row 12");
    // Row 12 holds 10 of the bar's 11, more than the 7.7 of its 70%, so the value area is that one row
    // and both of its edges are row 12.
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(12), Some(12), Some(12)));
}

#[test]
fn a_bar_whose_ticks_report_no_volume_counts_trades() {
    let ticks = [buy("1.10", "0"), buy("1.10", "0"), sell("1.10", "0")];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("three trades fill one row");

    // No tick of the bar reports a volume, so the row volumes count trades.
    assert_eq!(bar.volume, FootprintVolume::Ticks);
    // Each volume-less trade counts as one, so row 11 holds two buys and a sell.
    assert_eq!(bar.rows.len(), 1);
    let row = &bar.rows[0];
    assert_eq!(
        (row.buy_volume, row.sell_volume),
        (decimal("2.0"), decimal("1.0"))
    );
    assert_eq!(
        (bar.buy_volume, bar.sell_volume),
        (decimal("2.0"), decimal("1.0"))
    );
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(11), Some(11), Some(11)));
}

#[test]
fn a_bar_with_one_real_volume_reports_real_volume() {
    // The bar reports a volume, so its volumes are lots and the volume-less tick is a quote update left
    // out of the rows: only the two and a half lots bought count.
    let ticks = [buy("1.10", "0"), buy("1.10", "2.5")];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("two trades fill one row");

    assert_eq!(bar.volume, FootprintVolume::Real);
    assert_eq!(bar.buy_volume, decimal("2.5"));
}

#[test]
fn a_bar_counts_the_trades_of_each_side_per_row_and_in_total() {
    // Three buys and two sells over two ten-tick rows: 1.10 and 1.15 fill row 11 and 1.20 row 12. A
    // trade is one tick, so the two lots bought at 1.10 are one trade and not two.
    let ticks = [
        buy("1.10", "2.0"),
        buy("1.15", "1.0"),
        sell("1.15", "3.0"),
        buy("1.20", "4.0"),
        sell("1.20", "0.5"),
    ];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("five trades fill two rows");

    assert_eq!(bar.rows.len(), 2);
    let lower = &bar.rows[0];
    assert_eq!((lower.buy_trades, lower.sell_trades), (2, 1));
    assert_eq!(
        (lower.buy_volume, lower.sell_volume),
        (decimal("3.0"), decimal("3.0"))
    );
    let upper = &bar.rows[1];
    assert_eq!((upper.buy_trades, upper.sell_trades), (1, 1));
    assert_eq!(
        (upper.buy_volume, upper.sell_volume),
        (decimal("4.0"), decimal("0.5"))
    );
    assert_eq!(
        (bar.buy_trades, bar.sell_trades),
        (3, 2),
        "the bar counts what its rows counted"
    );
}

#[test]
fn a_bar_with_a_volume_counts_only_the_volume_ticks_as_trades() {
    // The bar reports a volume, so the volume-less tick at 1.10 is a quote update: it is no trade at all,
    // although it sits in the row of the trade beside it.
    let ticks = [buy("1.10", "2.0"), buy("1.10", "0"), sell("1.20", "3.0")];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar = bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings)
        .expect("two trades and a quote fill two rows");

    assert_eq!(bar.volume, FootprintVolume::Real);
    assert_eq!(bar.rows.len(), 2);
    assert_eq!((bar.rows[0].buy_trades, bar.rows[0].sell_trades), (1, 0));
    assert_eq!((bar.rows[1].buy_trades, bar.rows[1].sell_trades), (0, 1));
    assert_eq!(
        (bar.rows[0].buy_volume, bar.rows[0].sell_volume),
        (decimal("2.0"), decimal("0")),
        "the quote moves no volume either"
    );
    assert_eq!((bar.buy_trades, bar.sell_trades), (1, 1));
}

#[test]
fn a_bar_whose_ticks_report_no_volume_counts_every_tick_as_a_trade() {
    // A quote-only bar, where no tick carries a volume and each tick counts as one trade: three buys and
    // two sells, put in the row their price lands in.
    let ticks = [
        buy("1.10", "0"),
        buy("1.15", "0"),
        sell("1.15", "0"),
        buy("1.20", "0"),
        sell("1.20", "0"),
    ];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar =
        bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings).expect("five trades fill two rows");

    assert_eq!(bar.volume, FootprintVolume::Ticks);
    assert_eq!((bar.rows[0].buy_trades, bar.rows[0].sell_trades), (2, 1));
    assert_eq!((bar.rows[1].buy_trades, bar.rows[1].sell_trades), (1, 1));
    assert_eq!((bar.buy_trades, bar.sell_trades), (3, 2));
    // Each volume-less trade counts as one, so the volumes are the trade counts here.
    assert_eq!(
        (bar.buy_volume, bar.sell_volume),
        (decimal("3.0"), decimal("2.0"))
    );
}

#[test]
fn a_row_below_zero_is_numbered_negative() {
    // Four quarter ticks make a row of one price unit. -1.25 sits at tick -5, which floors to row -2 and
    // covers ticks -8 to -4, so the row runs from -2.00 to -1.00; 0.25 is tick 1 of the row that runs
    // from 0.00 to 1.00. Row -1 lies between the two and no trade reached it, so it is an empty row of
    // its own: the rows are contiguous levels.
    let ticks = [buy("-1.25", "3.0"), sell("0.25", "2.0")];
    let settings = FootprintSettings {
        ticks_per_row: 4,
        va_percent: default_va_percent(),
        imbalance_percent: never_an_imbalance(),
    };

    let bar = bar_footprint(OPEN_MS, &ticks, quarter_tick(), &settings)
        .expect("two trades fill three contiguous rows");

    assert_eq!(bar.rows.len(), 3, "row -2, the empty row -1, then row 0");
    let below = &bar.rows[0];
    assert_eq!(below.row, -2);
    assert_eq!(
        (below.down_price, below.up_price),
        (decimal("-2.0"), decimal("-1.0"))
    );
    assert_eq!(
        (below.buy_volume, below.sell_volume),
        (decimal("3.0"), decimal("0"))
    );
    let empty = &bar.rows[1];
    assert_eq!(empty.row, -1);
    assert_eq!(
        (empty.down_price, empty.up_price),
        (decimal("-1.0"), decimal("0"))
    );
    assert_eq!(
        (empty.buy_volume, empty.sell_volume),
        (Decimal::ZERO, Decimal::ZERO)
    );
    let above = &bar.rows[2];
    assert_eq!(above.row, 0);
    assert_eq!(
        (above.down_price, above.up_price),
        (decimal("0"), decimal("1.0"))
    );
    assert_eq!(
        (above.buy_volume, above.sell_volume),
        (decimal("0"), decimal("2.0"))
    );
    // 3 in row -2 beats 2 in row 0, and the value area of 70% of 5 is 3.5, so row 0 joins it: the empty
    // row -1 lies between them and holds nothing, so it joins without changing the edges.
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(-2), Some(0), Some(-2)));
}

#[test]
fn a_gap_between_two_rows_fills_with_empty_rows() {
    // Rows ten ticks wide: 1.10 sits at tick 110 (row 11) and 1.40 at tick 140 (row 14), so rows 12 and
    // 13 are the levels between them that no trade reached. They are rows all the same, with a price
    // range of their own and nothing on either side.
    let ticks = [buy("1.10", "2.0"), sell("1.40", "3.0")];
    let settings = ten_tick_rows(never_an_imbalance());

    let bar = bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings)
        .expect("two trades fill four contiguous rows");

    let numbers: Vec<i64> = bar.rows.iter().map(|row| row.row).collect();
    assert_eq!(numbers, [11, 12, 13, 14]);
    for empty in &bar.rows[1..3] {
        assert_eq!(
            (empty.buy_volume, empty.sell_volume),
            (Decimal::ZERO, Decimal::ZERO)
        );
        assert_eq!(
            (empty.buy_trades, empty.sell_trades),
            (0, 0),
            "a level no trade reached counted no trade either"
        );
        assert!(
            !empty.buy_imbalance && !empty.sell_imbalance,
            "an empty row has no side to be imbalanced"
        );
    }
    assert_eq!((bar.buy_trades, bar.sell_trades), (1, 1));
    assert_eq!(bar.rows[1].down_price, decimal("1.20"));
    assert_eq!(bar.rows[1].up_price, decimal("1.30"));
    assert_eq!(bar.rows[3].down_price, decimal("1.40"));
    // The empty levels hold no volume, so the bar sums what its trades moved and the POC is the 3 of row
    // 14 as it would be without them. Row 14's 3 does not cover the 3.5 of the 70%, so the value area
    // reaches down to row 11 through the two empty rows.
    assert_eq!(
        (bar.buy_volume, bar.sell_volume),
        (decimal("2.0"), decimal("3.0"))
    );
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(14), Some(14), Some(11)));
}

#[test]
fn a_buy_over_an_empty_row_below_is_an_imbalance() {
    // Tick 100 fills row 10 with one lot and tick 120 fills row 12 with three, so row 11 is the level
    // between them, empty on both sides. The imbalance rule asks that a side be above zero and at least
    // the set percentage of the opposite volume of the row right below, which may be zero: at 100% the
    // 3 bought in row 12 is past the 0 sold in row 11, so row 12 has a buy imbalance.
    let ticks = [buy("1.00", "1.0"), buy("1.20", "3.0")];
    let settings = ten_tick_rows(Decimal::from(100));

    let bar = bar_footprint(OPEN_MS, &ticks, cent_tick(), &settings)
        .expect("two trades fill three contiguous rows");

    assert_eq!(bar.rows.len(), 3);
    assert_eq!(bar.rows[1].row, 11);
    assert_eq!(
        (bar.rows[1].buy_volume, bar.rows[1].sell_volume),
        (Decimal::ZERO, Decimal::ZERO)
    );
    assert!(
        !bar.rows[1].buy_imbalance && !bar.rows[1].sell_imbalance,
        "an empty row has no side to be imbalanced"
    );
    assert!(
        !bar.rows[0].buy_imbalance,
        "row 10 is the lowest row, so no row lies below it"
    );
    assert!(bar.rows[2].buy_imbalance);
    assert!(!bar.rows[2].sell_imbalance, "row 12 sells nothing");
    // The empty row holds no volume, so the POC and the value area still follow the 3 of row 12.
    assert_eq!((bar.poc, bar.vah, bar.val), (Some(12), Some(12), Some(12)));
}

#[test]
fn a_bar_that_rows_nothing_has_no_footprint() {
    let ticks = [buy("1.10", "1.0")];
    let rowed = ten_tick_rows(never_an_imbalance());
    let no_rows = FootprintSettings {
        ticks_per_row: 0,
        ..rowed
    };

    let no_trades = bar_footprint(OPEN_MS, &[], cent_tick(), &rowed);
    assert!(no_trades.is_none(), "no trades leave no row");

    let no_tick_size = bar_footprint(OPEN_MS, &ticks, Decimal::ZERO, &rowed);
    assert!(no_tick_size.is_none(), "a widthless tick names no row");

    let widthless_row = bar_footprint(OPEN_MS, &ticks, cent_tick(), &no_rows);
    assert!(widthless_row.is_none(), "zero ticks per row names no row");
}

#[test]
fn a_bar_serializes_with_camel_case_names() {
    let ticks = [buy("1.10", "2.0")];
    let bar = bar_footprint(
        OPEN_MS,
        &ticks,
        cent_tick(),
        &ten_tick_rows(never_an_imbalance()),
    )
    .expect("one trade fills one row");

    let json = serde_json::to_value(&bar).expect("a bar serializes");

    assert_eq!(json["openMs"], serde_json::json!(OPEN_MS));
    assert_eq!(json["rows"][0]["row"], serde_json::json!(11));
    assert_eq!(json["rows"][0]["buyTrades"], serde_json::json!(1));
    assert_eq!(json["volume"], serde_json::json!("real"));
    assert!(
        json["rows"][0].get("downPrice").is_some() && json["rows"][0].get("down_price").is_none(),
        "the row's prices keep their camel case name"
    );
}
