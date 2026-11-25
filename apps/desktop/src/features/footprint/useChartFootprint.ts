import { useEffect, type RefObject } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ChartFootprintEvent, ChartFootprintFormingEvent } from '../../shared/bridge/types';
import { errorText } from '../../shared/errorText';
import { useNotifyError } from '../../shared/ui/notification/ErrorNotifications';
import type { VolumeFootprintAppearance } from '../chart/engine/barStyle/barStyleAppearance';
import type { BarFootprint } from '../chart/engine/barStyle/volumeFootprint/footprintData';
import { NO_FOOTPRINT_NOTICES } from '../chart/engine/legend/footprintNotice';
import type { ChartController } from '../chart/engine/surface/chartController';
import type { ChartFootprintView } from '../chart/engine/surface/chartFootprintView';
import { chartFootprintRequest } from './chartFootprintRequest';
import { listenChartFootprint, listenChartFootprintForming, setChartFootprint } from './footprintBridge';
import { footprintNoticesOf } from './footprintNotices';
import { readBarFootprint } from './footprintRead';

/** The chart the footprint bars are drawn on, how it draws them and which symbol it shows them for. */
export interface ChartFootprintSource {
  readonly chart: RefObject<ChartController | null>;
  /** The footprint appearance while that style draws the bars; null while another bar style does. */
  readonly appearance: VolumeFootprintAppearance | null;
  readonly symbol: string | undefined;
  readonly timeframe: string | undefined;
}

/**
 * The footprint the hook already holds for the bar still forming, which a window read never carries: the newest bar
 * it holds, kept only while that bar opens after every bar of the window.
 */
function formingFootprintOf(
  byBar: ReadonlyMap<number, BarFootprint>,
  bars: ChartFootprintEvent['bars'],
): BarFootprint | null {
  let newestMs = Number.NEGATIVE_INFINITY;
  let forming: BarFootprint | null = null;
  for (const footprint of byBar.values()) {
    if (footprint.openMs > newestMs) {
      newestMs = footprint.openMs;
      forming = footprint;
    }
  }
  if (forming === null) {
    return null;
  }
  // A bar the window lists is the window's own copy of it, so only a bar opening after all of them is still forming.
  const carried = bars.some((bar) => bar.openMs >= newestMs);
  return carried ? null : forming;
}

/**
 * Keeps the host's chart footprint on for exactly as long as the volume footprint style draws the bars, and
 * hands every footprint it publishes to the bar style series. A report the host makes for another symbol or
 * timeframe describes a chart that is not this one, so it is dropped.
 */
export function useChartFootprint({ chart, appearance, symbol, timeframe }: ChartFootprintSource): void {
  const notifyError = useNotifyError();
  // Whether the columns are painted at all: the style draws the bars and the chart knows which symbol it shows.
  const drawn = appearance !== null && symbol !== undefined && timeframe !== undefined;
  useEffect(() => {
    if (appearance === null || symbol === undefined || timeframe === undefined) {
      return;
    }
    const request = chartFootprintRequest(appearance);
    const byBar = new Map<number, BarFootprint>();
    // The newest bar the host read only partly, which the legend reports until the next whole window read.
    let incompleteBeforeMs: number | null = null;
    const withFootprintView = (write: (view: ChartFootprintView) => void) => {
      const shown = chart.current;
      if (shown !== null) {
        write(shown.footprints);
      }
    };
    // The window's whole read: every bar's footprint arrives together, so the series takes them as one set.
    const publish = () => {
      withFootprintView((view) => {
        view.setFootprints([...byBar.values()]);
        view.setNotices(footprintNoticesOf(incompleteBeforeMs));
      });
    };
    // The forming bar alone: it says nothing about the ticks that were read only part way in, so the legend is
    // left as it is and the series rewrites that one bar's point.
    const publishForming = (footprint: BarFootprint) => {
      withFootprintView((view) => view.setFormingFootprint(footprint));
    };
    const acceptFootprint = (event: ChartFootprintEvent) => {
      if (event.symbol !== symbol || event.timeframe !== timeframe) {
        return;
      }
      incompleteBeforeMs = event.incompleteBefore;
      // A window lists only the bars the host read whole, so the bar still forming is not one of them: the footprint
      // its own read put here stays, or that bar would drop back to a plain candle until the next forming read.
      const forming = formingFootprintOf(byBar, event.bars);
      byBar.clear();
      for (const bar of event.bars) {
        byBar.set(bar.openMs, readBarFootprint(bar));
      }
      if (forming !== null) {
        byBar.set(forming.openMs, forming);
      }
      publish();
    };
    const acceptForming = (event: ChartFootprintFormingEvent) => {
      const bar = event.bar;
      if (bar === null || event.symbol !== symbol || event.timeframe !== timeframe) {
        return;
      }
      const footprint = readBarFootprint(bar);
      byBar.set(footprint.openMs, footprint);
      publishForming(footprint);
    };
    let live = true;
    const unlisteners: UnlistenFn[] = [];
    const keep = (unlisten: UnlistenFn) => {
      if (live) {
        unlisteners.push(unlisten);
        return;
      }
      unlisten();
    };
    const report = (error: unknown) => {
      if (live) {
        notifyError(errorText(error));
      }
    };
    // Subscribe first: the host's own read can finish before the command that starts it answers.
    void listenChartFootprint(acceptFootprint).then(keep, report);
    void listenChartFootprintForming(acceptForming).then(keep, report);
    void setChartFootprint(request).catch(report);
    return () => {
      live = false;
      for (const unlisten of unlisteners) {
        unlisten();
      }
      // The host publishes nothing while the footprint is off, so the style cannot keep costing it reads.
      void setChartFootprint(null).catch(() => undefined);
    };
  }, [appearance, chart, notifyError, symbol, timeframe]);
  // Rows of another symbol, of another chart or of a style that left must not stay painted on these bars. A
  // re-run that keeps the chart, the symbol and the timeframe keeps the paint: the host's next window replaces
  // the columns where they stand, where clearing them first would blank them for a frame.
  useEffect(() => {
    if (!drawn || symbol === undefined || timeframe === undefined) {
      return;
    }
    // The controller the columns were painted on: the cleanup clears that chart, not whichever the ref holds then.
    const painted = chart.current;
    return () => {
      painted?.footprints.setFootprints([]);
      painted?.footprints.setNotices(NO_FOOTPRINT_NOTICES);
    };
  }, [chart, drawn, symbol, timeframe]);
}
