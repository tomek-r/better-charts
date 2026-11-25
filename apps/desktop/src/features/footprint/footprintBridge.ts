/**
 * The frontend's only door to the host's chart footprint: the rows, POC and value area of the bars
 * the host read whole, computed from the same precise tick feed the Pine scripts read.
 *
 * The chart footprint is off until `setChartFootprint` turns it on, and the host publishes nothing
 * while it is off. Listen before enabling: the window's read can finish before the command resolves.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { ChartFootprintEvent, ChartFootprintFormingEvent, ChartFootprintRequest } from '../../shared/bridge/types';

export const CHART_FOOTPRINT_EVENT = 'chart-footprint';
export const CHART_FOOTPRINT_FORMING_EVENT = 'chart-footprint-forming';

/**
 * Turns the chart footprint on with `request`, or off with `null`. A request the host cannot publish
 * rejects with its reason, so the chart never draws rows the host would not compute.
 */
export async function setChartFootprint(request: ChartFootprintRequest | null): Promise<void> {
  await invoke('set_chart_footprint', { settings: request });
}

/** Listens for the loaded window's footprints: one payload per finished read, complete bars only. */
export function listenChartFootprint(onFootprint: (footprint: ChartFootprintEvent) => void): Promise<UnlistenFn> {
  return listen<ChartFootprintEvent>(CHART_FOOTPRINT_EVENT, (event) => onFootprint(event.payload));
}

/** Listens for the forming bar's footprint, after each whole re-read of its ticks. */
export function listenChartFootprintForming(
  onForming: (forming: ChartFootprintFormingEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChartFootprintFormingEvent>(CHART_FOOTPRINT_FORMING_EVENT, (event) => onForming(event.payload));
}
