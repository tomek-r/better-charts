import { useEffect, useState, type RefObject } from 'react';
import type { ChartTimeFormat } from './chartTimeFormat';
import type { ChartController } from '../engine/surface/chartController';
import { useChartResources } from '../ChartWorkspaceProvider';

const MS_PER_SECOND = 1000;

/**
 * How long until the chart clock's next whole second, so the label never reads a second behind.
 * Broker time differs from UTC by whole minutes only, so its second boundaries are UTC's.
 */
function msUntilNextSecond(nowMs: number): number {
  return MS_PER_SECOND - (nowMs % MS_PER_SECOND);
}

/** The chart's broker time, or the desktop clock until a live tick and the broker's offset are known. */
function chartNowMs(chart: RefObject<ChartController | null>): number {
  return chart.current?.clockNowMs() ?? Date.now();
}

/**
 * The zone's live clock; null while the zone has no clock (the broker offset is not known yet).
 * It reads the chart's broker time, the same clock the bar countdown counts on, so the two cannot
 * disagree when the desktop clock is skewed; the desktop clock only stands in before the first live
 * tick, when broker time is unknown.
 */
export function useChartClock(format: ChartTimeFormat): string | null {
  const { chart } = useChartResources();
  const [nowMs, setNowMs] = useState(() => chartNowMs(chart));

  // One timer per tick, each scheduled from the clock rather than from the previous fire: a late
  // timer then costs one tick instead of drifting a second further every second.
  useEffect(() => {
    const timer = setTimeout(() => setNowMs(chartNowMs(chart)), msUntilNextSecond(nowMs));
    return () => clearTimeout(timer);
  }, [chart, nowMs]);

  return format.clockLabel(nowMs);
}
