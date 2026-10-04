//! Compare the old quadratic planner against the production coverage sweep.
use std::time::Instant;
use trading_core::volume_profile::{plan_tick_ranges, TickRange};

fn old_planner(request: TickRange, cached: &[TickRange]) -> Vec<TickRange> {
    let mut gaps = vec![request];
    for covered in cached {
        let mut next = Vec::new();
        for gap in gaps {
            if covered.end_ms <= gap.start_ms || covered.start_ms >= gap.end_ms {
                next.push(gap);
                continue;
            }
            if gap.start_ms < covered.start_ms {
                next.push(TickRange {
                    start_ms: gap.start_ms,
                    end_ms: covered.start_ms,
                });
            }
            if covered.end_ms < gap.end_ms {
                next.push(TickRange {
                    start_ms: covered.end_ms,
                    end_ms: gap.end_ms,
                });
            }
        }
        gaps = next;
    }
    gaps
}

fn median_us(mut run: impl FnMut()) -> f64 {
    let mut samples = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        run();
        samples.push(start.elapsed());
    }
    samples.sort_unstable();
    samples[2].as_secs_f64() * 1_000_000.0
}

fn main() {
    for count in [64, 256, 1024, 4096] {
        let request = TickRange {
            start_ms: 0,
            end_ms: count * 2 + 1,
        };
        let cached = (0..count)
            .map(|index| TickRange {
                start_ms: index * 2 + 1,
                end_ms: index * 2 + 2,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            old_planner(request, &cached),
            plan_tick_ranges(request, &cached)
        );
        let old = median_us(|| {
            std::hint::black_box(old_planner(request, &cached));
        });
        let new = median_us(|| {
            std::hint::black_box(plan_tick_ranges(request, &cached));
        });
        println!("ranges={count} old_us={old:.3} sweep_us={new:.3}");
    }
}
