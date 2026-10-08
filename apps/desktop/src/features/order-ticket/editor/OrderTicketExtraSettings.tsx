import type { TimeInForce } from '../../../shared/bridge/types';
import { useOrderTicketExtraSettings } from './orderTicketExitViews';

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
              <select
                className="ticket-mode"
                value={timeInForce}
                onChange={(event) => setTimeInForce(event.target.value as TimeInForce)}
                aria-label="Time in force"
              >
                <option value="gtc">GTC</option>
                <option value="day">Day</option>
                <option value="ioc">IOC</option>
                <option value="fok">FOK</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
