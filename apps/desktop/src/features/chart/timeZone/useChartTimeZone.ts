import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../shared/errorText';
import { useNotifyError } from '../../../shared/ui/notification/ErrorNotifications';
import { useBridgeConnection } from '../../bridge/bridgeSelectors';
import { useChartResources } from '../ChartWorkspaceProvider';
import { chartScopeKey, useChartScope } from '../useChartScope';
import type { ChartTimeZoneStore } from './chartTimeZoneStore';
import { EXCHANGE_TIME_ZONE, isKnownChartTimeZone } from './chartTimeZones';

/** What the time zone picker offers and does for the chart on screen. */
export interface ChartTimeZoneChoice {
  /** The zone the chart is shown in; the exchange until this chart's own zone has loaded. */
  readonly zone: string;
  /** The broker's UTC offset in minutes, null while the bridge has not reported one. */
  readonly brokerUtcOffsetMinutes: number | null;
  readonly selectZone: (zone: string) => void;
}

/** The zone on screen: the scope it was chosen for, and whether the user or the store chose it. */
interface ZoneChoice {
  /** The scope the zone belongs to; undefined when the chart had no scope to save it under yet. */
  readonly scopeKey: string | undefined;
  readonly zone: string;
  readonly chosenByUser: boolean;
}

/** A stored zone this build no longer offers is shown as the exchange rather than formatted as garbage. */
function storedZone(zone: string | null): string {
  return zone !== null && isKnownChartTimeZone(zone) ? zone : EXCHANGE_TIME_ZONE;
}

/** The choice a load answers with: its zone, unless the user already picked one for this same scope. */
function loadedChoice(current: ZoneChoice | undefined, scopeKey: string | undefined, zone: string): ZoneChoice {
  if (current !== undefined && current.chosenByUser && current.scopeKey === scopeKey) {
    return current;
  }
  return { scopeKey, zone, chosenByUser: false };
}

/**
 * The time zone of the chart on screen: the zone saved for this account and symbol, the user's
 * choice, and the chart engine kept in step with both. Keyed by the chart's scope, so switching
 * symbol or account loads the zone of the chart arrived at instead of carrying the last one over.
 */
export function useChartTimeZone(store: ChartTimeZoneStore): ChartTimeZoneChoice {
  const { chart } = useChartResources();
  const { status } = useBridgeConnection();
  const scope = useChartScope();
  const scopeKey = chartScopeKey(scope);
  const notifyError = useNotifyError();
  const brokerUtcOffsetMinutes = status.brokerUtcOffsetMinutes ?? null;
  const [choice, setChoice] = useState<ZoneChoice | undefined>(undefined);

  useEffect(() => {
    if (!scope) {
      return;
    }
    const { accountKey, symbol } = scope;
    let scopeChanged = false;
    store
      .load(accountKey, symbol)
      .then((saved) => {
        // A load that lands after the scope moved on belongs to another window.
        if (scopeChanged) {
          return;
        }
        setChoice((current) => loadedChoice(current, scopeKey, storedZone(saved)));
      })
      .catch((error: unknown) => {
        if (scopeChanged) {
          return;
        }
        notifyError(errorText(error));
        setChoice((current) => loadedChoice(current, scopeKey, EXCHANGE_TIME_ZONE));
      });
    return () => {
      scopeChanged = true;
    };
  }, [notifyError, scope, scopeKey, store]);

  const selectZone = useCallback(
    (zone: string) => {
      setChoice({ scopeKey, zone, chosenByUser: true });
      if (!scope) {
        return;
      }
      store.save(scope.accountKey, scope.symbol, zone).catch((error: unknown) => notifyError(errorText(error)));
    },
    [notifyError, scope, scopeKey, store],
  );

  const zone = choice !== undefined && choice.scopeKey === scopeKey ? choice.zone : EXCHANGE_TIME_ZONE;

  useEffect(() => {
    chart.current?.setTimeZone(zone, brokerUtcOffsetMinutes);
  }, [brokerUtcOffsetMinutes, chart, zone]);

  return { zone, brokerUtcOffsetMinutes, selectZone };
}
