import { quoteDigits } from '../../shared/format';
import { ChartSection } from './ChartSection';
import { useBridgeActions, useBridgeConnection, useBridgeMarket } from '../bridge/BridgeSessionProvider';
import { useChartResources } from './ChartWorkspaceProvider';

export function ChartWorkspaceView() {
  const { status, tauriAvailable } = useBridgeConnection();
  const { snapshot, quote, symbolLoading, chartError } = useBridgeMarket();
  const { requestHistory } = useBridgeActions();
  const { chartHost } = useChartResources();

  const quotePrecision = quote ? quoteDigits(quote.bid, quote.ask, quote.last) : 2;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const spread = Number.isFinite(bid) && Number.isFinite(ask) ? (ask - bid).toFixed(quotePrecision) : '—';

  return (
    <ChartSection
      symbolLoading={symbolLoading}
      snapshot={snapshot}
      quote={quote}
      quotePrecision={quotePrecision}
      spread={spread}
      status={status}
      requestHistory={requestHistory}
      chartHost={chartHost}
      waiting={!tauriAvailable || snapshot.candles.length === 0}
      chartError={chartError}
    />
  );
}
