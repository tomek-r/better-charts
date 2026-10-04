import { type RefObject } from 'react';
import type { BridgeStatus, MarketSnapshot, QuoteSnapshot } from '../../shared/bridge/types';
import { formatQuote } from '../../shared/format';
import { timeframeOptions } from '../../shared/bridge/timeframes';

export function ChartSection({
  symbolLoading,
  snapshot,
  quote,
  quotePrecision,
  spread,
  status,
  requestHistory,
  chartHost,
  waiting,
  chartError,
}: {
  symbolLoading: boolean;
  snapshot: MarketSnapshot;
  quote: QuoteSnapshot | undefined;
  quotePrecision: number;
  spread: string;
  status: BridgeStatus;
  requestHistory: (wire: string) => Promise<void>;
  chartHost: RefObject<HTMLDivElement | null>;
  waiting: boolean;
  chartError: string | undefined;
}) {
  return (
    <section className="chart-section">
      <div className="chart-heading">
        <div>
          <p className="eyebrow">MARKET DATA</p>
          <h1>{symbolLoading ? 'Loading symbol…' : (snapshot.symbol ?? 'Waiting for symbol')}</h1>
        </div>
        <div className="quote-cards" aria-label="Realtime quote">
          <div>
            <small>BID</small>
            <b>{quote ? formatQuote(quote.bid, quotePrecision) : '—'}</b>
          </div>
          <div>
            <small>SPREAD</small>
            <b>{spread}</b>
          </div>
          <div>
            <small>ASK</small>
            <b>{quote ? formatQuote(quote.ask, quotePrecision) : '—'}</b>
          </div>
        </div>
      </div>
      <div className="timeframe-tabs" role="group" aria-label="Chart timeframe">
        {timeframeOptions.map((option) => {
          const isActive = snapshot.timeframe === option.wire;
          return (
            <button
              key={option.wire}
              className={isActive ? 'active' : ''}
              disabled={!snapshot.symbol || status.state !== 'connected' || symbolLoading}
              aria-pressed={isActive}
              onClick={() => void requestHistory(option.wire)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="chart-frame">
        <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
        {(waiting || symbolLoading) && (
          <div className="chart-overlay">
            <span className="overlay-glyph">◒</span>
            <strong>{symbolLoading ? 'Loading market data' : (chartError ?? 'Waiting for market data')}</strong>
            <span>{status.message ?? 'Connect MT5 bridge to load candles.'}</span>
          </div>
        )}
        {chartError && !waiting && !symbolLoading && (
          <div className="chart-error" role="alert">
            {chartError}
          </div>
        )}
      </div>
    </section>
  );
}
