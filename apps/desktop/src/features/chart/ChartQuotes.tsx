import { useBridgeQuote } from '../bridge/BridgeSessionProvider';
import { formatQuote, quoteDigits } from '../../shared/format';

export function ChartQuotes() {
  const quote = useBridgeQuote();
  const quotePrecision = quote ? quoteDigits(quote.bid, quote.ask, quote.last) : 2;
  const bid = quote ? Number(quote.bid) : NaN;
  const ask = quote ? Number(quote.ask) : NaN;
  const spread = Number.isFinite(bid) && Number.isFinite(ask) ? (ask - bid).toFixed(quotePrecision) : '—';

  return (
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
  );
}
