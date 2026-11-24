use super::*;

/// A price or a volume written as it reads.
fn decimal(text: &str) -> Decimal {
    text.parse().expect("a decimal literal")
}

/// A row spanning `[down_price, up_price)` with the volume each side traded in it.
fn row(down_price: i64, up_price: i64, buy_volume: i64, sell_volume: i64) -> FootprintRow {
    FootprintRow {
        down_price: Decimal::from(down_price),
        up_price: Decimal::from(up_price),
        buy_volume: Decimal::from(buy_volume),
        sell_volume: Decimal::from(sell_volume),
    }
}

#[test]
fn summarizes_totals_poc_value_area_and_imbalance() {
    let rows = [
        row(100, 101, 10, 50),
        row(101, 102, 60, 20),
        row(102, 103, 5, 5),
    ];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("200"));

    // buy = 10 + 60 + 5 = 75, sell = 50 + 20 + 5 = 75.
    assert_eq!(summary.buy_volume, decimal("75"));
    assert_eq!(summary.sell_volume, decimal("75"));

    // Row totals are 60, 80, 10, so the POC is row 1.
    assert_eq!(summary.poc, Some(1));

    // The value area covers 70% of 150, which is 105. Start at row 1 (80); the higher-volume neighbour
    // is row 0 (60) over row 2 (10), giving 140 >= 105, so the value area covers rows 0..=1.
    assert_eq!(summary.val, Some(0));
    assert_eq!(summary.vah, Some(1));

    // A row is flagged only when its own volume is > 0 and at least twice (200%) the opposite side of
    // the adjacent row.
    // row 0 buy: no row below, false; sell: 50 > 0 but 50 * 100 < 60 * 200, false.
    // row 1 buy: 60 > 0 but 60 * 100 < 50 * 200, false; sell: 20 > 0 and 20 * 100 >= 5 * 200, true.
    // row 2 buy: 5 > 0 but 5 * 100 < 20 * 200, false; sell: no row above, false.
    assert_eq!(summary.buy_imbalance, vec![false, false, false]);
    assert_eq!(summary.sell_imbalance, vec![false, true, false]);
}

#[test]
fn flags_a_row_whose_buy_volume_dwarfs_the_row_below() {
    let rows = [
        row(100, 101, 5, 10),
        row(101, 102, 40, 5),
        row(102, 103, 5, 5),
    ];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("200"));

    // buy = 5 + 40 + 5 = 50, sell = 10 + 5 + 5 = 20.
    assert_eq!(summary.buy_volume, decimal("50"));
    assert_eq!(summary.sell_volume, decimal("20"));

    // Row totals are 15, 45, 10, so the POC is row 1. The value area covers 70% of 70, which is 49:
    // row 1 (45) plus its higher-volume neighbour row 0 (15) covers 60 >= 49, so it spans rows 0..=1.
    assert_eq!(summary.poc, Some(1));
    assert_eq!(summary.val, Some(0));
    assert_eq!(summary.vah, Some(1));

    // row 0 buy: no row below, false; sell: 10 > 0 but 10 * 100 < 40 * 200, false.
    // row 1 buy: 40 > 0 and 40 * 100 >= 10 * 200, true; sell: 5 > 0 but 5 * 100 < 5 * 200, false.
    // row 2 buy: 5 > 0 but 5 * 100 < 5 * 200, false; sell: no row above, false.
    assert_eq!(summary.buy_imbalance, vec![false, true, false]);
    assert_eq!(summary.sell_imbalance, vec![false, false, false]);
}

#[test]
fn flags_imbalance_against_an_empty_opposite_side() {
    // The rule compares against the opposite side only, so a zero sell volume below still leaves a
    // positive buy volume imbalanced.
    let rows = [row(100, 101, 0, 0), row(101, 102, 5, 0)];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("300"));

    // row 0 buy: no row below, false; sell: 0 is not > 0, false.
    // row 1 buy: 5 > 0 and 5 * 100 >= 0 * 300, true; sell: no row above, false.
    assert_eq!(summary.buy_imbalance, vec![false, true]);
    assert_eq!(summary.sell_imbalance, vec![false, false]);
}

#[test]
fn never_flags_an_empty_row() {
    // Both sides are zero: 0 >= ratio * 0 would hold, but the imbalanced side must itself be > 0, so an
    // empty level is never an imbalance.
    let rows = [row(100, 101, 0, 0), row(101, 102, 0, 0)];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("300"));

    assert_eq!(summary.buy_imbalance, vec![false, false]);
    assert_eq!(summary.sell_imbalance, vec![false, false]);
}

#[test]
fn never_flags_a_zero_side_against_a_zero_opposite_side() {
    // A zero side is never an imbalance even when the opposite side is also zero and the bare
    // `0 >= ratio * 0` comparison would hold.
    let rows = [
        row(100, 101, 5, 0),
        row(101, 102, 0, 0),
        row(102, 103, 0, 5),
    ];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("300"));

    // row 0 buy: no row below, false; sell: 0 is not > 0, false.
    // row 1 buy: 0 is not > 0, false; sell: 0 is not > 0, false.
    // row 2 buy: 0 is not > 0, false; sell: no row above, false.
    assert_eq!(summary.buy_imbalance, vec![false, false, false]);
    assert_eq!(summary.sell_imbalance, vec![false, false, false]);
}

#[test]
fn empty_footprint_has_no_poc_and_no_value_area() {
    let summary = summarize_footprint(&[], decimal("70"), decimal("200"));

    assert_eq!(summary.buy_volume, Decimal::ZERO);
    assert_eq!(summary.sell_volume, Decimal::ZERO);
    assert_eq!(summary.poc, None);
    assert_eq!(summary.val, None);
    assert_eq!(summary.vah, None);
    assert!(summary.buy_imbalance.is_empty());
    assert!(summary.sell_imbalance.is_empty());
}

#[test]
fn equal_volume_poc_is_the_last_of_the_maximal_rows() {
    let rows = [
        row(100, 101, 5, 5),
        row(101, 102, 5, 5),
        row(102, 103, 5, 5),
    ];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("200"));

    // Every row totals 10, so the POC is the last such row, row 2.
    assert_eq!(summary.poc, Some(2));

    // The value area covers 70% of 30, which is 21. Row 2 (10) then row 1 (10) cover 20 < 21, then row
    // 0 (10) covers 30 >= 21, so the value area spans rows 0..=2.
    assert_eq!(summary.val, Some(0));
    assert_eq!(summary.vah, Some(2));
}

#[test]
fn delta_is_the_buy_volume_over_the_sell_volume() {
    let rows = [row(100, 101, 30, 20)];
    let summary = summarize_footprint(&rows, decimal("70"), decimal("200"));
    assert_eq!(summary.delta(), decimal("10"));

    let empty = summarize_footprint(&[], decimal("70"), decimal("200"));
    assert_eq!(empty.delta(), Decimal::ZERO);
}
