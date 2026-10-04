//! Compare two market-only native probe captures; never connects to MT5.
use rust_decimal::Decimal;
use trading_core::protocol::{
    Envelope, TickHistoryRequest, TickHistorySnapshot, TickPriceHistorySnapshot,
};
use trading_core::volume_profile::{
    calculate_fixed_range_profile, FixedRangeProfileAccumulator, FixedRangeProfileConfig, Tick,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let paths = std::env::args().skip(1).collect::<Vec<_>>();
    if paths.len() != 2 {
        return Err("usage: tick_price_validate <raw-market.json> <price-market.json>".into());
    }
    let raw: Envelope = serde_json::from_slice(&std::fs::read(&paths[0])?)?;
    let raw: TickHistorySnapshot = serde_json::from_value(raw.payload)?;
    let summary: Envelope = serde_json::from_slice(&std::fs::read(&paths[1])?)?;
    let summary: TickPriceHistorySnapshot = serde_json::from_value(summary.payload)?;
    let request = TickHistoryRequest {
        symbol: raw.symbol.clone(),
        from_ms: raw.from_ms,
        to_ms: raw.to_ms,
        max_ticks: 65535,
    };
    raw.validate(&request)?;
    summary.validate(&request)?;
    let ticks = raw
        .ticks
        .iter()
        .filter(|tick| tick.time_ms < summary.through_ms)
        .map(|tick| {
            Ok(Tick {
                time_millis: tick.time_ms,
                bid: tick.bid.parse()?,
                ask: tick.ask.parse()?,
                flags: tick.flags,
            })
        })
        .collect::<Result<Vec<_>, rust_decimal::Error>>()?;
    assert_eq!(ticks.len(), summary.loaded_ticks as usize);
    let mut counts = FixedRangeProfileAccumulator::new(250_000);
    for item in &summary.prices {
        counts.merge_price_counts(
            item.price.parse()?,
            [
                u64::from(item.total),
                u64::from(item.bid),
                u64::from(item.ask),
            ],
            item.bid_seen,
        )?;
    }
    let quotes = summary
        .min_quote
        .as_ref()
        .zip(summary.max_quote.as_ref())
        .map(|(low, high)| Ok::<_, rust_decimal::Error>((low.parse()?, high.parse()?)))
        .transpose()?;
    counts.merge_quote_range(u64::from(summary.rejected_ticks), quotes)?;
    let mut bids = ticks.iter().map(|tick| tick.bid).collect::<Vec<_>>();
    bids.sort_unstable();
    bids.dedup();
    let fallback = bids
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .filter(|gap| *gap > Decimal::ZERO)
        .min();
    if let Some(fallback) = fallback {
        assert_eq!(counts.inferred_tick_size(), fallback);
    }
    for tick_size in [raw.tick_size.parse()?, counts.inferred_tick_size()] {
        let config = FixedRangeProfileConfig {
            tick_size,
            ..Default::default()
        };
        assert_eq!(
            counts.calculate(&config),
            calculate_fixed_range_profile(&config, &ticks)
        );
    }
    println!(
        "Native exactness verified: ticks={} prices={} (broker grid and fallback)",
        ticks.len(),
        summary.prices.len()
    );
    Ok(())
}
