/** One exits row of the TV-style order ticket: unit label + ON/OFF switch and a
 * dual ticks⇄price field. The price string is the canonical value (what the
 * backend receives); the ticks view converts through the instrument tick size
 * and is disabled when the tick size is unknown. */
import type { KeyboardEvent } from 'react';
import { CaretIcon } from '../../../../shared/ui/icons/CaretIcon';

export function TicketExitRow({
  label,
  ticksMode,
  on,
  onToggle,
  price,
  ticks,
  onTicks,
  onPrice,
  onSwap,
  swapDisabled,
  priceInvalid,
  onEditingChange,
}: {
  label: string;
  ticksMode: boolean;
  on: boolean;
  onToggle: (checked: boolean) => void;
  price: string;
  ticks: string;
  onTicks: (value: string) => void;
  onPrice: (value: string) => void;
  onSwap: () => void;
  swapDisabled: boolean;
  priceInvalid?: boolean;
  /** Reports focus in/out of the value inputs; Enter commits by leaving the input. */
  onEditingChange?: (editing: boolean) => void;
}) {
  const editing = {
    onFocus: () => onEditingChange?.(true),
    onBlur: () => onEditingChange?.(false),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (onEditingChange && event.key === 'Enter') {
        event.currentTarget.blur();
      }
    },
  };
  return (
    <div className={`ticket-exit${on ? '' : ' off'}`}>
      <div className="ticket-exit-head">
        <span className="ticket-row-label">
          {label}, {ticksMode ? 'ticks' : 'price'} <CaretIcon className="ticket-caret" />
        </span>
        <input
          type="checkbox"
          role="switch"
          className="ticket-switch"
          checked={on}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`${label} enabled`}
        />
      </div>
      <div className={`ticket-field${on ? '' : ' off'}`}>
        {ticksMode ? (
          <input
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="ticket-value"
            inputMode="decimal"
            value={ticks}
            disabled={!on}
            onChange={(event) => onTicks(event.target.value)}
            {...editing}
            placeholder="Ticks"
            type="number"
            aria-label={`${label} ticks`}
          />
        ) : (
          <input
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={`ticket-value${priceInvalid ? ' invalid' : ''}`}
            inputMode="decimal"
            value={price}
            disabled={!on}
            onChange={(event) => onPrice(event.target.value)}
            {...editing}
            placeholder="Price"
            aria-label={`${label} price`}
          />
        )}
        <button
          className="ticket-swap"
          disabled={swapDisabled || !on}
          onClick={onSwap}
          aria-label={`Swap ${label} input to ${ticksMode ? 'price' : 'ticks'}`}
          title={
            swapDisabled
              ? 'Tick size unknown — conversion disabled'
              : `Edit ${label} in ${ticksMode ? 'price' : 'ticks'}`
          }
        >
          ⇄
        </button>
        <span className="ticket-unit ticket-unit-readout">
          {ticksMode ? `${price || '—'} price` : `${ticks || '—'} ticks`}
        </span>
      </div>
    </div>
  );
}
