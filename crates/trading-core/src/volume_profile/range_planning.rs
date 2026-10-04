/// A half-open interval of tick timestamps in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickRange {
    pub start_ms: i64,
    pub end_ms: i64,
}

impl TickRange {
    pub fn is_valid(self) -> bool {
        self.start_ms < self.end_ms
    }

    /// Kept as a compatibility alias; new code should use [`Self::is_valid`].
    pub fn valid(self) -> bool {
        self.is_valid()
    }
}

/// Plans disjoint requests for a half-open range. Cached complete ranges are
/// subtracted first; incomplete one-millisecond ranges are terminal leaves.
pub fn plan_tick_ranges(request: TickRange, cached: &[TickRange]) -> Vec<TickRange> {
    if !request.is_valid() {
        return Vec::new();
    }
    let mut covered = cached
        .iter()
        .copied()
        .filter(|range| {
            range.is_valid() && range.start_ms < request.end_ms && range.end_ms > request.start_ms
        })
        .map(|range| TickRange {
            start_ms: range.start_ms.max(request.start_ms),
            end_ms: range.end_ms.min(request.end_ms),
        })
        .collect::<Vec<_>>();
    covered.sort_unstable_by_key(|range| (range.start_ms, range.end_ms));
    let mut cursor = request.start_ms;
    let mut gaps = Vec::new();
    // Sorted coverage needs one sweep, including overlapping cache pages.
    for range in covered {
        if range.start_ms > cursor {
            gaps.push(TickRange {
                start_ms: cursor,
                end_ms: range.start_ms,
            });
        }
        cursor = cursor.max(range.end_ms);
        if cursor >= request.end_ms {
            break;
        }
    }
    if cursor < request.end_ms {
        gaps.push(TickRange {
            start_ms: cursor,
            end_ms: request.end_ms,
        });
    }
    gaps
}
