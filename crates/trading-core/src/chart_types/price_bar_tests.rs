use super::*;

const TIME_MS: i64 = 1_000;
const TICK_VOLUME: u64 = 7;

fn price(text: &str) -> Decimal {
    text.parse().unwrap()
}

fn candle(open: &str, high: &str, low: &str, close: &str) -> MarketCandle {
    MarketCandle {
        time_ms: TIME_MS,
        open: open.into(),
        high: high.into(),
        low: low.into(),
        close: close.into(),
        tick_volume: TICK_VOLUME,
        spread: 1,
        real_volume: 0,
    }
}

#[test]
fn conversion_keeps_the_time_and_prices_as_decimals() {
    let converted = PriceBar::from_market_candle(&candle("10.5", "11", "10", "10.8"));
    let expected = PriceBar {
        time_ms: TIME_MS,
        open: price("10.5"),
        high: price("11"),
        low: price("10"),
        close: price("10.8"),
        volume: Decimal::from(TICK_VOLUME),
    };
    assert_eq!(converted, Ok(expected));
}

#[test]
fn real_volume_wins_over_tick_volume() {
    let mut reported = candle("10.5", "11", "10", "10.8");
    reported.real_volume = 3;
    let converted = PriceBar::from_market_candle(&reported).unwrap();
    assert_eq!(converted.volume, Decimal::from(3u64));
    let unreported = candle("10.5", "11", "10", "10.8");
    let converted = PriceBar::from_market_candle(&unreported).unwrap();
    assert_eq!(converted.volume, Decimal::from(TICK_VOLUME));
}

#[test]
fn a_price_that_is_not_decimal_is_rejected_with_its_field() {
    let broken = candle("10.5", "1.0.0", "10", "10.8");
    assert_eq!(
        PriceBar::from_market_candle(&broken),
        Err(ChartTypeError::InvalidPrice { field: "high" })
    );
}
