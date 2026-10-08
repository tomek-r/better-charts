import { useBridgeQuotePresentation } from '../bridge/useBridgeQuotePresentation';

export function ChartQuotes() {
  const { bidText, askText, spreadText } = useBridgeQuotePresentation();

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
