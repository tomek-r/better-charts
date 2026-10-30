import { useEffect, useState } from 'react';
import type { ChartTimeFormat } from './chartTimeFormat';

const MS_PER_SECOND = 1000;

/** How long until the wall clock's next whole second, so the label never reads a second behind. */
function msUntilNextSecond(nowMs: number): number {
  return MS_PER_SECOND - (nowMs % MS_PER_SECOND);
}

/** The zone's live clock; null while the zone has no clock (the broker offset is not known yet). */
export function useChartClock(format: ChartTimeFormat): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());

  // One timer per tick, each scheduled from the clock rather than from the previous fire: a late
  // timer then costs one tick instead of drifting a second further every second.
  useEffect(() => {
    const timer = setTimeout(() => setNowMs(Date.now()), msUntilNextSecond(nowMs));
    return () => clearTimeout(timer);
  }, [nowMs]);

  return format.clockLabel(nowMs);
}
