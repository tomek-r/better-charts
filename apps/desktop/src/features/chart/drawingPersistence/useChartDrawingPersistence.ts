import { useEffect, useRef } from 'react';
import { errorText } from '../../../shared/errorText';
import { useNotifyError } from '../../../shared/ui/notification/ErrorNotifications';
import { useBridgeChartState } from '../../bridge/bridgeSelectors';
import { useChartScope, type ChartScope } from '../useChartScope';
import { useChartResources } from '../ChartWorkspaceProvider';
import type { ChartDrawingStore } from './chartDrawingStore';
import { LatestSaveQueue } from './latestSaveQueue';

/**
 * Saves every drawing on the chart per account and symbol, and restores them when that symbol comes
 * back: after a symbol switch, a timeframe switch, a reconnect or an app restart the drawings return
 * with their ids, lock flags and settings.
 */
export function useChartDrawingPersistence(store: ChartDrawingStore): void {
  const { chart } = useChartResources();
  const { symbol } = useBridgeChartState();
  const notifyError = useNotifyError();
  const scope = useChartScope();
  /** The scope whose drawings the chart holds: the only one a change may be saved under. */
  const loadedScope = useRef<ChartScope | undefined>(undefined);
  /** The saves of the loaded scope; a change of scope starts a new one, so orders never mix. */
  const saves = useRef<LatestSaveQueue | undefined>(undefined);
  /** The symbol on screen, so a change can never land in the list of a symbol being left. */
  const shownSymbol = useRef<string | undefined>(undefined);

  useEffect(() => {
    shownSymbol.current = symbol;
  }, [symbol]);

  // The chart drops every drawing on a symbol, session or connection change, so the stored ones of
  // the scope go back in here. Nothing may be saved until they arrived: a file the backend could not
  // read stays exactly as it is instead of being replaced by the empty chart.
  useEffect(() => {
    const drawings = chart.current?.drawings;
    loadedScope.current = undefined;
    saves.current = undefined;
    if (!scope || !drawings) {
      return;
    }
    const { accountKey, symbol: scopeSymbol } = scope;
    let scopeChanged = false;
    store
      .load(accountKey, scopeSymbol)
      .then((records) => {
        // A load that lands after the scope moved on belongs to another window.
        if (scopeChanged) {
          return;
        }
        drawings.replaceRecords(records);
        loadedScope.current = { accountKey, symbol: scopeSymbol };
        saves.current = new LatestSaveQueue((changed) => store.save(accountKey, scopeSymbol, changed), notifyError);
      })
      .catch((error: unknown) => {
        if (!scopeChanged) {
          notifyError(errorText(error));
        }
      });
    return () => {
      scopeChanged = true;
    };
  }, [chart, notifyError, scope, store]);

  // Subscribed once per chart: a place, edit, delete, lock or settings change hands the whole set to
  // the queue of the loaded scope, and only under a scope whose symbol is still the one on screen.
  useEffect(() => {
    const drawings = chart.current?.drawings;
    if (!drawings) {
      return;
    }
    return drawings.subscribeChanges(() => {
      const loaded = loadedScope.current;
      const queue = saves.current;
      if (!loaded || !queue || loaded.symbol !== shownSymbol.current) {
        return;
      }
      queue.enqueue(drawings.exportRecords());
    });
  }, [chart]);
}
