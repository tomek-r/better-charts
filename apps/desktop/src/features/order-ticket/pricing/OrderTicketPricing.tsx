import type { OrderKind } from '../../../shared/bridge/types';
import { ErrorNotification } from '../../../shared/ui/notification/ErrorNotifications';
import { Select, type SelectOption } from '../../../shared/ui/select/Select';
import { useOrderTicketPricingProps } from './useOrderTicketPricingProps';

const PRICE_REFERENCE_OPTIONS: readonly SelectOption[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'bid', label: 'Bid' },
];

const ORDER_KIND_TABS: ReadonlyArray<{ kind: OrderKind; label: string }> = [
  { kind: 'market', label: 'Market' },
  { kind: 'limit', label: 'Limit' },
  { kind: 'stop', label: 'Stop' },
  { kind: 'stop_limit', label: 'Stop Limit' },
];

/** The ticket's decimal text-number input; autofill and spellcheck stay off so prices are never rewritten. */
function PriceInput({
  value,
  onChange,
  placeholder,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      autoComplete="one-time-code"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className="ticket-value"
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      type="number"
      aria-label={label}
    />
  );
}

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
  } = useOrderTicketPricingProps();
  const absolutePrice = orderKind === 'market' || priceMode === 'absolute';
  let displayedPriceReference = priceReference;
  if (orderKind === 'market') {
    displayedPriceReference = riskSide === 'buy' ? 'ask' : 'bid';
  }
  return (
    <>
      <div className="ticket-type-tabs" role="group" aria-label="Order type">
        {ORDER_KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            className={`ticket-type-tab${orderKind === tab.kind ? ' active' : ''}`}
            aria-pressed={orderKind === tab.kind}
            onClick={() => setOrderKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={`ticket-row${orderKind === 'market' ? ' disabled' : ''}`}>
        <span className="ticket-row-label">{orderKind === 'stop_limit' ? 'Trigger price' : 'Price offset'}</span>
        <div className="ticket-field">
          <Select
            className="ticket-ref"
            ariaLabel="Price reference"
            options={PRICE_REFERENCE_OPTIONS}
            value={displayedPriceReference}
            disabled={absolutePrice || !hasQuote}
            onChange={(next) => setPriceReference(next as 'ask' | 'bid')}
          />
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
            <PriceInput
              value={entry}
              onChange={setEntry}
              placeholder="Price"
              label="Order price"
              disabled={orderKind === 'market'}
            />
          ) : (
            <PriceInput
              value={priceOffset}
              onChange={setPriceOffset}
              placeholder="Ticks"
              label="Price offset in ticks"
            />
          )}
          <span className="ticket-unit">{absolutePrice ? 'price' : 'ticks'}</span>
        </div>
      </div>
      {orderKind === 'stop_limit' && (
        <div className="ticket-row">
          <span className="ticket-row-label">Limit price</span>
          <div className="ticket-field">
            <PriceInput value={limitPrice} onChange={setLimitPrice} placeholder="Price" label="Limit price" />
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
