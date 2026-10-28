import { useOrderTicketTickValueProps } from './useOrderTicketTickValueProps';

export function OrderTicketTickValue() {
  const { hasInstrument, tickValueText, currency } = useOrderTicketTickValueProps();
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
