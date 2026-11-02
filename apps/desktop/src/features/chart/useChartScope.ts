import { useMemo } from 'react';
import type { BridgeStatus } from '../../shared/bridge/types';
import { useBridgeAccount, useBridgeChartState, useBridgeConnection } from '../bridge/bridgeSelectors';
import { accountIdentityKey } from '../bridge/lastChartSelection/lastChartSelection';
import { useChartId } from './chartSettings/ChartSettingsProvider';

/**
 * The chart, account and symbol one chart holds its own state for: its drawings and its settings.
 * A chart saves them per chart id, so two charts on the same symbol keep their own.
 */
export interface ChartScope {
  readonly chartId: string;
  readonly accountKey: string;
  readonly symbol: string;
}

/** What the chart on screen offers: which chart it is, a connection, an account, and a symbol. */
interface ChartScopeSource {
  readonly chartId: string | undefined;
  readonly connectionState: BridgeStatus['state'];
  readonly accountKey: string | undefined;
  readonly symbol: string | undefined;
  readonly hasCandles: boolean;
  readonly symbolLoading: boolean;
}

/**
 * The scope the chart can hold state for, or undefined while it can hold none. An unknown chart, a
 * half-known account, a symbol still loading or a symbol without bars would restore or save state
 * that belongs to another window, so each of them withholds the scope.
 */
function chartScope(source: ChartScopeSource): ChartScope | undefined {
  const { chartId, connectionState, accountKey, symbol, hasCandles, symbolLoading } = source;
  if (!chartId || connectionState !== 'connected' || !accountKey || !symbol || !hasCandles || symbolLoading) {
    return undefined;
  }
  return { chartId, accountKey, symbol };
}

/** The scope as one primitive an effect can depend on; the newlines keep the three parts apart. */
export function chartScopeKey(scope: ChartScope | undefined): string | undefined {
  return scope ? `${scope.chartId}\n${scope.accountKey}\n${scope.symbol}` : undefined;
}

/** The chart's scope, kept as one stable value for as long as its chart, account and symbol stay put. */
export function useChartScope(): ChartScope | undefined {
  const chartId = useChartId();
  const { status } = useBridgeConnection();
  const account = useBridgeAccount();
  const { symbol, hasCandles, symbolLoading } = useBridgeChartState();
  const connectionState = status.state;
  const accountKey = accountIdentityKey(account?.accountLogin, account?.brokerServer);
  return useMemo(
    () => chartScope({ chartId, connectionState, accountKey, symbol, hasCandles, symbolLoading }),
    [accountKey, chartId, connectionState, hasCandles, symbol, symbolLoading],
  );
}
