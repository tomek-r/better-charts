import { useEffect, useRef } from 'react';
import { errorText } from '../../../shared/errorText';
import type { BridgeStatus } from '../../../shared/bridge/types';
import { useNotifyError } from '../../../shared/ui/ErrorNotifications';
import { useBridgeAccount, useBridgeChartState, useBridgeConnection } from '../../bridge/BridgeSessionProvider';
import { accountIdentityKey } from '../../bridge/lastChartSelection';
import { useChartResources } from '../ChartWorkspaceProvider';
import type { ChartDrawingStore } from './chartDrawingStore';
import { LatestSaveQueue } from './latestSaveQueue';

/** The account and symbol one set of drawings belongs to. */
interface DrawingScope {
  readonly accountKey: string;
  readonly symbol: string;
}

/** What the chart on screen offers: a connection, an account, and a symbol with its bars. */
interface DrawingScopeSource {
  readonly connectionState: BridgeStatus['state'];
  readonly accountKey: string | undefined;
  readonly symbol: string | undefined;
  readonly hasCandles: boolean;
  readonly symbolLoading: boolean;
}

/**
 * The scope the chart can hold drawings for, or undefined while it can hold none. A half-known
 * account, a symbol still loading or a symbol without bars would restore or save drawings that
 * belong to another window, so each of them withholds the scope.
 */
function drawingScope(source: DrawingScopeSource): DrawingScope | undefined {
  const { connectionState, accountKey, symbol, hasCandles, symbolLoading } = source;
  if (connectionState !== 'connected' || !accountKey || !symbol || !hasCandles || symbolLoading) {
    return undefined;
  }
  return { accountKey, symbol };
}

/** The scope as one primitive an effect can depend on; the newline keeps the two halves apart. */
function drawingScopeKey(scope: DrawingScope | undefined): string | undefined {
  return scope ? `${scope.accountKey}\n${scope.symbol}` : undefined;
}

/**
 * Saves every drawing on the chart per account and symbol, and restores them when that symbol comes
 * back: after a symbol switch, a timeframe switch, a reconnect or an app restart the drawings return
 * with their ids, lock flags and settings.
 */
export function useChartDrawingPersistence(store: ChartDrawingStore): void {
  const { chart } = useChartResources();
  const { status } = useBridgeConnection();
  const account = useBridgeAccount();
  const { symbol, hasCandles, symbolLoading } = useBridgeChartState();
  const notifyError = useNotifyError();
  const accountKey = accountIdentityKey(account?.accountLogin, account?.brokerServer);
  const scopeKey = drawingScopeKey(
    drawingScope({ connectionState: status.state, accountKey, symbol, hasCandles, symbolLoading }),
  );
  /** The scope whose drawings the chart holds: the only one a change may be saved under. */
  const loadedScope = useRef<DrawingScope | undefined>(undefined);
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
    if (!scopeKey || !accountKey || !symbol || !drawings) {
      return;
    }
    let scopeChanged = false;
    store
      .load(accountKey, symbol)
      .then((records) => {
        // A load that lands after the scope moved on belongs to another window.
        if (scopeChanged) {
          return;
        }
        drawings.replaceRecords(records);
        loadedScope.current = { accountKey, symbol };
        saves.current = new LatestSaveQueue((changed) => store.save(accountKey, symbol, changed), notifyError);
      })
      .catch((error: unknown) => {
        if (!scopeChanged) {
          notifyError(errorText(error));
        }
      });
    return () => {
      scopeChanged = true;
    };
  }, [accountKey, chart, notifyError, scopeKey, store, symbol]);

  // Subscribed once per chart: a place, edit, delete, lock or settings change hands the whole set to
  // the queue of the loaded scope, and only under a scope whose symbol is still the one on screen.
  useEffect(() => {
    const drawings = chart.current?.drawings;
    if (!drawings) {
      return;
    }
    return drawings.subscribeChanges(() => {
      const scope = loadedScope.current;
      const queue = saves.current;
      if (!scope || !queue || scope.symbol !== shownSymbol.current) {
        return;
      }
      queue.enqueue(drawings.exportRecords());
    });
  }, [chart]);
}
