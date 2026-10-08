import { useBridgeQuote } from '../bridge/BridgeSessionProvider';
import { deriveQuotePresentation } from '../../shared/format';

export function ChartQuotes() {
  const quote = useBridgeQuote();
  const { bidText, askText, spreadText } = deriveQuotePresentation(quote);

  return (
    <div className="quote-cards" aria-label="Realtime quote">
      <div>
        <small>BID</small>
        <b>{bidText}</b>
      </div>
      <div>
        <small>SPREAD</small>
        <b>{spreadText}</b>
      </div>
      <div>
        <small>ASK</small>
        <b>{askText}</b>
      </div>
    </div>
  );
}
