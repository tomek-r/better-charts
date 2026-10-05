import { formatQuote } from '../../../shared/format';
import { useOrderTicketQuotes } from '../OrderTicketProvider';

export function OrderTicketQuotes() {
  const {
    value: quoteValue,
    precision: quotePrecision,
    spread,
    spreadBadge,
    spreadPoints,
    side: riskSide,
    stageFromQuote,
  } = useOrderTicketQuotes();
  return (
    <>
      <div className="ticket-quote" role="group" aria-label="Order side">
        <button
          className={`ticket-quote-side sell${riskSide === 'sell' ? ' active' : ''}`}
          aria-pressed={riskSide === 'sell'}
          onClick={() => stageFromQuote('sell')}
        >
          <small>Sell</small>
          <b>{quoteValue ? formatQuote(quoteValue.bid, quotePrecision) : '—'}</b>
        </button>
        <span
          className="ticket-spread"
          title={
            spreadPoints !== null
              ? `${spreadPoints} pts · ${spread} price units`
              : 'Instrument point size unknown — raw price spread'
          }
        >
          {spreadBadge}
        </span>
        <button
          className={`ticket-quote-side buy${riskSide === 'buy' ? ' active' : ''}`}
          aria-pressed={riskSide === 'buy'}
          onClick={() => stageFromQuote('buy')}
        >
          <small>Buy</small>
          <b>{quoteValue ? formatQuote(quoteValue.ask, quotePrecision) : '—'}</b>
        </button>
      </div>
    </>
  );
}
