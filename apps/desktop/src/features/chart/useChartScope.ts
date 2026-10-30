import { useMemo } from 'react';
import type { BridgeStatus } from '../../shared/bridge/types';
import { useBridgeAccount, useBridgeChartState, useBridgeConnection } from '../bridge/bridgeSelectors';
import { accountIdentityKey } from '../bridge/lastChartSelection/lastChartSelection';

/** The account and symbol one chart holds its own state for: its drawings and its time zone. */
export interface ChartScope {
  readonly accountKey: string;
  readonly symbol: string;
}

/** What the chart on screen offers: a connection, an account, and a symbol with its bars. */
interface ChartScopeSource {
  readonly connectionState: BridgeStatus['state'];
  readonly accountKey: string | undefined;
  readonly symbol: string | undefined;
  readonly hasCandles: boolean;
  readonly symbolLoading: boolean;
}

/**
 * The scope the chart can hold state for, or undefined while it can hold none. A half-known
 * account, a symbol still loading or a symbol without bars would restore or save state that
 * belongs to another window, so each of them withholds the scope.
 */
function chartScope(source: ChartScopeSource): ChartScope | undefined {
  const { connectionState, accountKey, symbol, hasCandles, symbolLoading } = source;
  if (connectionState !== 'connected' || !accountKey || !symbol || !hasCandles || symbolLoading) {
    return undefined;
  }
  return { accountKey, symbol };
}

/** The scope as one primitive an effect can depend on; the newline keeps the two halves apart. */
export function chartScopeKey(scope: ChartScope | undefined): string | undefined {
  return scope ? `${scope.accountKey}\n${scope.symbol}` : undefined;
}

/** The chart's scope, kept as one stable value for as long as the account and symbol stay put. */
export function useChartScope(): ChartScope | undefined {
  const { status } = useBridgeConnection();
  const account = useBridgeAccount();
  const { symbol, hasCandles, symbolLoading } = useBridgeChartState();
  const connectionState = status.state;
  const accountKey = accountIdentityKey(account?.accountLogin, account?.brokerServer);
  return useMemo(
    () => chartScope({ connectionState, accountKey, symbol, hasCandles, symbolLoading }),
    [accountKey, connectionState, hasCandles, symbol, symbolLoading],
  );
}
