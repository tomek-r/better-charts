import type { TimeInForce } from '../../../../shared/bridge/types';
import { Select, type SelectOption } from '../../../../shared/ui/select/Select';
import { useOrderTicketExtraSettings } from './useOrderTicketExtraSettings';

const TIME_IN_FORCE_OPTIONS: readonly SelectOption[] = [
  { value: 'gtc', label: 'GTC' },
  { value: 'day', label: 'Day' },
  { value: 'ioc', label: 'IOC' },
  { value: 'fok', label: 'FOK' },
];

export function OrderTicketExtraSettings() {
  const {
    open: extraSettingsOpen,
    setOpen: setExtraSettingsOpen,
    timeInForce,
    setTimeInForce,
  } = useOrderTicketExtraSettings();
  return (
    <>
      <div className="ticket-collapse">
        <button
          className="ticket-collapse-head"
          aria-expanded={extraSettingsOpen}
          onClick={() => setExtraSettingsOpen(!extraSettingsOpen)}
        >
          Extra settings <span aria-hidden="true">{extraSettingsOpen ? '▾' : '▸'}</span>
        </button>
        {extraSettingsOpen && (
          <div className="ticket-collapse-body">
            <div className="ticket-row">
              <span className="ticket-row-label">Time in force</span>
              <Select
                className="ticket-mode"
                listClassName="ticket-mode-list"
                ariaLabel="Time in force"
                options={TIME_IN_FORCE_OPTIONS}
                value={timeInForce}
                onChange={(next) => setTimeInForce(next as TimeInForce)}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
