import { useEffect, useRef } from 'react';
import { useChartResources } from '../ChartWorkspaceProvider';
import {
  PRICE_SCALE_MODE_REQUESTED_EVENT,
  type PriceScaleModeRequestDetail,
} from '../engine/priceScale/priceScaleController';
import { withScalesValue, type ChartSettings } from './chartSettings';

/** The newest settings and the way to keep them, so the chart's listener is attached once. */
interface PriceScaleModeRequestTargets {
  readonly settings: ChartSettings;
  readonly keep: (next: ChartSettings) => void;
}

/**
 * The `L` toggle asks for the other price scale mode with an event raised on the chart's host: the
 * engine never holds a React callback. The mode is one of the chart's saved scales settings, so the
 * request is kept as `priceScaleMode` and reaches the chart the way every other scales change does.
 *
 * The listener reads the newest settings and `keep` through a ref: both change on every edit, and
 * re-attaching the listener for each of them would miss a press that lands while it is swapped.
 */
export function usePriceScaleModeRequests(settings: ChartSettings, keep: (next: ChartSettings) => void): void {
  const { chartHost } = useChartResources();
  const targets = useRef<PriceScaleModeRequestTargets>({ settings, keep });

  useEffect(() => {
    targets.current = { settings, keep };
  }, [keep, settings]);

  useEffect(() => {
    const host = chartHost.current;
    if (!host) {
      return;
    }
    const keepRequestedMode = (event: Event) => {
      const { mode } = (event as CustomEvent<PriceScaleModeRequestDetail>).detail;
      const { settings: current, keep: keepCurrent } = targets.current;
      keepCurrent(withScalesValue(current, 'priceScaleMode', mode));
    };
    host.addEventListener(PRICE_SCALE_MODE_REQUESTED_EVENT, keepRequestedMode);
    return () => host.removeEventListener(PRICE_SCALE_MODE_REQUESTED_EVENT, keepRequestedMode);
  }, [chartHost]);
}
