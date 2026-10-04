//! Synthetic computation benchmark; no broker, sockets, or account access.
use rust_decimal::Decimal;
use std::time::Instant;
use trading_core::volume_profile::{
    calculate_fixed_range_profile, FixedRangeProfileAccumulator, FixedRangeProfileConfig, Tick,
};

fn tick(index: usize) -> Tick {
    let bid = Decimal::from(10_000 + index % 2_000) / Decimal::from(100);
    Tick {
        time_millis: index as i64,
        bid,
        ask: bid + Decimal::new(1, 2),
        flags: [2, 4, 6, 0][index % 4],
    }
}

fn main() {
    let config = FixedRangeProfileConfig {
        tick_size: Decimal::new(1, 2),
        ..Default::default()
    };
    let ticks = (0..1_000_000).map(tick).collect::<Vec<_>>();
    let start = Instant::now();
    let batch = calculate_fixed_range_profile(&config, &ticks);
    println!("batch_1m_ms={:.3}", start.elapsed().as_secs_f64() * 1000.0);
    for count in [1_000_000, 5_000_000] {
        let mut accumulator = FixedRangeProfileAccumulator::new(250_000);
        let start = Instant::now();
        for index in 0..count {
            accumulator.push(&tick(index)).unwrap();
        }
        let ingest_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let profile = accumulator.calculate(&config);
        let finalize_ms = start.elapsed().as_secs_f64() * 1000.0;
        if count == ticks.len() {
            assert_eq!(profile, batch);
        }
        assert_eq!(profile.total_weight, (count * 3 / 4) as u64);
        println!(
            "ticks={count} prices={} ingest_ms={ingest_ms:.3} finalize_ms={finalize_ms:.3}",
            accumulator.price_count()
        );
    }
}
