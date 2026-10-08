import { ErrorNotification } from '../../../shared/ui/ErrorNotifications';
import { useOrderTicketPricing } from './useOrderTicketPricing';

export function OrderTicketPricing() {
  const {
    instrument,
    orderKind,
    setOrderKind,
    entry,
    setEntry,
    priceMode,
    priceOffset,
    setPriceOffset,
    priceReference,
    setPriceReference,
    priceSwapDisabled,
    priceSwapTitle,
    togglePriceMode,
    limitPrice,
    setLimitPrice,
    limitPriceValid,
    limitPriceMisaligned,
    side: riskSide,
    hasQuote,
  } = useOrderTicketPricing();
  const absolutePrice = orderKind === 'market' || priceMode === 'absolute';
  let displayedPriceReference = priceReference;
  if (orderKind === 'market') {
    displayedPriceReference = riskSide === 'buy' ? 'ask' : 'bid';
  }
  return (
    <>
      <div className="ticket-type-tabs" role="group" aria-label="Order type">
        <button
          className={`ticket-type-tab${orderKind === 'market' ? ' active' : ''}`}
          aria-pressed={orderKind === 'market'}
          onClick={() => setOrderKind('market')}
        >
          Market
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'limit' ? ' active' : ''}`}
          aria-pressed={orderKind === 'limit'}
          onClick={() => setOrderKind('limit')}
        >
          Limit
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'stop' ? ' active' : ''}`}
          aria-pressed={orderKind === 'stop'}
          onClick={() => setOrderKind('stop')}
        >
          Stop
        </button>
        <button
          className={`ticket-type-tab${orderKind === 'stop_limit' ? ' active' : ''}`}
          aria-pressed={orderKind === 'stop_limit'}
          onClick={() => setOrderKind('stop_limit')}
        >
          Stop Limit
        </button>
      </div>
      <div className={`ticket-row${orderKind === 'market' ? ' disabled' : ''}`}>
        <span className="ticket-row-label">{orderKind === 'stop_limit' ? 'Trigger price' : 'Price offset'}</span>
        <div className="ticket-field">
          <select
            className="ticket-ref"
            value={displayedPriceReference}
            disabled={absolutePrice || !hasQuote}
            onChange={(event) => setPriceReference(event.target.value as 'ask' | 'bid')}
            aria-label="Price reference"
          >
            <option value="ask">Ask</option>
            <option value="bid">Bid</option>
          </select>
          <button
            className="ticket-swap"
            disabled={priceSwapDisabled}
            onClick={togglePriceMode}
            aria-label={absolutePrice ? 'Enter price as an offset from the reference' : 'Enter an absolute price'}
            title={priceSwapTitle}
          >
            ⇄
          </button>
          {absolutePrice ? (
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={entry}
              disabled={orderKind === 'market'}
              onChange={(event) => setEntry(event.target.value)}
              placeholder="Price"
              type="number"
              aria-label="Order price"
            />
          ) : (
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={priceOffset}
              onChange={(event) => setPriceOffset(event.target.value)}
              placeholder="Ticks"
              type="number"
              aria-label="Price offset in ticks"
            />
          )}
          <span className="ticket-unit">{absolutePrice ? 'price' : 'ticks'}</span>
        </div>
      </div>
      {orderKind === 'stop_limit' && (
        <div className="ticket-row">
          <span className="ticket-row-label">Limit price</span>
          <div className="ticket-field">
            <input
              autoComplete="one-time-code"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="ticket-value"
              inputMode="decimal"
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
              placeholder="Price"
              type="number"
              aria-label="Limit price"
            />
            <span className="ticket-unit">price</span>
          </div>
        </div>
      )}
      {orderKind === 'stop_limit' && !limitPriceValid && (
        <ErrorNotification message="stop_limit requires limit price — enter the resting limit price after the trigger." />
      )}
      {orderKind === 'stop_limit' && limitPriceMisaligned && (
        <p className="ticket-hint">Limit price is not tick-aligned (step {instrument?.tickSize}).</p>
      )}
    </>
  );
}
