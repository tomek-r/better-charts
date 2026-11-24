use super::*;
use crate::footprint::{bar_footprint, BarFootprint, FootprintSettings, FootprintTick, TickSide};

/// The bar every footprint in these tests belongs to.
const OPEN_MS: i64 = 1_700_000_000_000;

/// A price or a volume written as it reads.
fn decimal(text: &str) -> Decimal {
    text.parse().expect("a decimal literal")
}

/// Settings that split a bar into rows of ten ticks and flag an imbalance at `imbalance_percent`.
fn settings(imbalance_percent: i64) -> FootprintSettings {
    FootprintSettings {
        ticks_per_row: 10,
        va_percent: Decimal::from(70),
        imbalance_percent: Decimal::from(imbalance_percent),
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

/// The footprint of the bar `ticks` fill, with an imbalance at `imbalance_percent`.
fn footprint_of(ticks: &[FootprintTick], imbalance_percent: i64) -> BarFootprint {
    let chart_settings = settings(imbalance_percent);
    let mintick = decimal("0.01");
    bar_footprint(OPEN_MS, ticks, mintick, &chart_settings).expect("the trades fill rows")
}

#[test]
fn two_adjacent_buy_imbalances_are_one_zone() {
    // Row 10 buys 1 at 1.00, row 12 buys 3 at 1.20 and row 13 buys 5 at 1.30; row 11 is the empty level
    // between them. Rows 12 and 13 each buy at least the 100% of the nothing sold in the row below, and
    // they are adjacent rows, so they stack into one zone.
    let ticks = [buy("1.00", "1.0"), buy("1.20", "3.0"), buy("1.30", "5.0")];
    let footprint = footprint_of(&ticks, 100);

    let zones = stacked_imbalance_zones(&footprint.rows, 2);

    assert_eq!(zones.len(), 1);
    let zone = &zones[0];
    assert_eq!(zone.side, Side::Buy);
    assert_eq!((zone.low_row, zone.high_row), (12, 13));
    assert_eq!(
        (zone.down_price, zone.up_price),
        (decimal("1.20"), decimal("1.40"))
    );
    assert_eq!(zone.row_count, 2);
}

#[test]
fn a_sell_stack_is_a_zone_of_its_own() {
    // Rows 12 and 13 sell 5 and 3 into bids the row above does not answer: 100% of the buy volume of the
    // row above is 0 for row 12 and 1 for row 13, so both are sell imbalances and stack into one zone.
    let ticks = [sell("1.20", "5.0"), sell("1.30", "3.0"), buy("1.40", "1.0")];
    let footprint = footprint_of(&ticks, 100);

    let zones = stacked_imbalance_zones(&footprint.rows, 2);

    assert_eq!(zones.len(), 1);
    let zone = &zones[0];
    assert_eq!(zone.side, Side::Sell);
    assert_eq!((zone.low_row, zone.high_row), (12, 13));
    assert_eq!(
        (zone.down_price, zone.up_price),
        (decimal("1.20"), decimal("1.40"))
    );
    assert_eq!(zone.row_count, 2);
}

#[test]
fn a_single_imbalance_is_no_stack() {
    // Only row 12 is flagged at 100%: it buys 3 over the empty sell volume of row 11 below, while row 13
    // sells 1 as the highest row, which has no row above to compare with.
    let ticks = [buy("1.10", "1.0"), buy("1.20", "3.0"), sell("1.30", "1.0")];
    let footprint = footprint_of(&ticks, 100);

    assert!(
        stacked_imbalance_zones(&footprint.rows, 2).is_empty(),
        "a single imbalanced row is no stack"
    );
    let single = stacked_imbalance_zones(&footprint.rows, 1);
    assert_eq!(single.len(), 1);
    assert_eq!((single[0].low_row, single[0].high_row), (12, 12));
    assert_eq!(single[0].row_count, 1);
}

#[test]
fn a_row_the_rule_does_not_flag_splits_a_stack() {
    // At 200% rows 11 and 13 are buy imbalanced, while row 12 buys 1 against the 1 sold below it, which
    // is only half of what the percentage asks for, so the two flagged rows are separate zones.
    let ticks = [
        buy("1.00", "1.0"),
        buy("1.10", "5.0"),
        sell("1.10", "1.0"),
        buy("1.20", "1.0"),
        buy("1.30", "7.0"),
    ];
    let footprint = footprint_of(&ticks, 200);

    let zones = stacked_imbalance_zones(&footprint.rows, 1);

    assert_eq!(zones.len(), 2);
    assert_eq!((zones[0].low_row, zones[0].row_count), (11, 1));
    assert_eq!((zones[1].low_row, zones[1].row_count), (13, 1));
    assert!(stacked_imbalance_zones(&footprint.rows, 2).is_empty());
}

#[test]
fn a_row_imbalanced_on_both_sides_ends_the_runs_around_it() {
    // At 100% row 11 sells 5 into the 5 bought above it, and row 12 both buys 5 over the 5 sold below and
    // sells 5 into the 5 bought above: row 12 belongs to neither stack, so the sell run ends at row 11 and
    // a buy run starts at row 13.
    let ticks = [
        sell("1.10", "5.0"),
        buy("1.20", "5.0"),
        sell("1.20", "5.0"),
        buy("1.30", "5.0"),
    ];
    let footprint = footprint_of(&ticks, 100);

    let zones = stacked_imbalance_zones(&footprint.rows, 1);

    assert_eq!(zones.len(), 2);
    assert_eq!((zones[0].side, zones[0].low_row), (Side::Sell, 11));
    assert_eq!((zones[1].side, zones[1].low_row), (Side::Buy, 13));
}
