import { useOrderTicketQuotes } from '../OrderTicketProvider';

export function OrderTicketQuotes() {
  const { bidText, askText, spreadText, spreadPoints, side: riskSide, stageFromQuote } = useOrderTicketQuotes();
  return (
    <>
      <div className="ticket-quote" role="group" aria-label="Order side">
        <button
          className={`ticket-quote-side sell${riskSide === 'sell' ? ' active' : ''}`}
          aria-pressed={riskSide === 'sell'}
          onClick={() => stageFromQuote('sell')}
        >
          <small>Sell</small>
          <b>{bidText}</b>
        </button>
        <span
          className="ticket-spread"
          title={
            spreadPoints !== null
              ? `${spreadPoints} pts · ${spreadText} price units`
              : 'Instrument point size unknown — raw price spread'
          }
        >
          {spreadText}
        </span>
        <button
          className={`ticket-quote-side buy${riskSide === 'buy' ? ' active' : ''}`}
          aria-pressed={riskSide === 'buy'}
          onClick={() => stageFromQuote('buy')}
        >
          <small>Buy</small>
          <b>{askText}</b>
        </button>
      </div>
    </>
  );
}
