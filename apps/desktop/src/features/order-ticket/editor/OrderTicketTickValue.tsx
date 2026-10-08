import { useOrderTicketTickValue } from './orderTicketSizingViews';

export function OrderTicketTickValue() {
  const { hasInstrument, tickValueText, currency } = useOrderTicketTickValue();
  return (
    <div className="ticket-row static">
      <span className="ticket-row-label">Tick value</span>
      <div className="ticket-field">
        {hasInstrument ? (
          <b className="ticket-tick-value">
            ≈ {tickValueText} {currency ?? ''}
          </b>
        ) : (
          <span className="ticket-hint">Instrument metadata unknown</span>
        )}
      </div>
    </div>
  );
}
