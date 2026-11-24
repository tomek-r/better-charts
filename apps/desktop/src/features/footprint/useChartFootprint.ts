import { useEffect, type RefObject } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ChartFootprintEvent, ChartFootprintFormingEvent } from '../../shared/bridge/types';
import { errorText } from '../../shared/errorText';
import { useNotifyError } from '../../shared/ui/notification/ErrorNotifications';
import type { VolumeFootprintAppearance } from '../chart/engine/barStyle/barStyleAppearance';
import type { BarFootprint } from '../chart/engine/barStyle/volumeFootprint/footprintData';
import { NO_FOOTPRINT_NOTICES } from '../chart/engine/legend/footprintNotice';
import type { ChartController } from '../chart/engine/surface/chartController';
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
 * Keeps the host's chart footprint on for exactly as long as the volume footprint style draws the bars, and
 * hands every footprint it publishes to the bar style series. A report the host makes for another symbol or
 * timeframe describes a chart that is not this one, so it is dropped.
 */
export function useChartFootprint({ chart, appearance, symbol, timeframe }: ChartFootprintSource): void {
  const notifyError = useNotifyError();
  useEffect(() => {
    if (appearance === null || symbol === undefined || timeframe === undefined) {
      return;
    }
    const controller = chart.current;
    const request = chartFootprintRequest(appearance);
    const byBar = new Map<number, BarFootprint>();
    // The newest bar the host read only partly, which the legend reports until the next whole window read.
    let incompleteBeforeMs: number | null = null;
    const publish = () => {
      const shown = chart.current;
      if (shown === null) {
        return;
      }
      const footprints = [...byBar.values()];
      shown.footprints.setFootprints(footprints);
      shown.footprints.setNotices(footprintNoticesOf(footprints, incompleteBeforeMs, appearance.values));
    };
    const acceptFootprint = (event: ChartFootprintEvent) => {
      if (event.symbol !== symbol || event.timeframe !== timeframe) {
        return;
      }
      incompleteBeforeMs = event.incompleteBefore;
      byBar.clear();
      for (const bar of event.bars) {
        byBar.set(bar.openMs, readBarFootprint(bar));
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
      publish();
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
      // Rows of another symbol or of an older window must not stay painted on these bars.
      controller?.footprints.setFootprints([]);
      controller?.footprints.setNotices(NO_FOOTPRINT_NOTICES);
      // The host publishes nothing while the footprint is off, so the style cannot keep costing it reads.
      void setChartFootprint(null).catch(() => undefined);
    };
  }, [appearance, chart, notifyError, symbol, timeframe]);
}
