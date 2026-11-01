import { useCallback, useMemo, useRef, useState } from 'react';
import { useBridgeConnectionSelector } from '../../bridge/bridgeSelectors';
import { useChartSettings } from '../chartSettings/ChartSettingsProvider';
import { createChartTimeFormat } from './chartTimeFormat';
import { ChartTimeZoneMenu } from './ChartTimeZoneMenu';
import { useChartClock } from './useChartClock';

/** The label the button falls back to while the zone has no clock of its own. */
const EXCHANGE_BUTTON_LABEL = 'Exchange';

/**
 * The live clock of the chart's time zone, under the chart's right corner; clicking it opens the
 * zone list. The zone is one of the chart's settings: its template's, unless this chart overrides
 * it for the account and symbol on screen.
 */
export function ChartTimeZoneControl() {
  const { settings, selectTimeZone } = useChartSettings();
  const brokerUtcOffsetMinutes = useBridgeConnectionSelector(({ status }) => status.brokerUtcOffsetMinutes) ?? null;
  const zone = settings.timeZone;
  const format = useMemo(() => createChartTimeFormat(zone, brokerUtcOffsetMinutes), [brokerUtcOffsetMinutes, zone]);
  const clock = useChartClock(format);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const chooseZone = useCallback(
    (next: string) => {
      setOpen(false);
      selectTimeZone(next);
    },
    [selectTimeZone],
  );

  return (
    <div className="chart-time-zone-picker" ref={pickerRef}>
      <button
        ref={buttonRef}
        className="chart-time-zone-button"
        aria-label="Time zone"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {clock ?? EXCHANGE_BUTTON_LABEL}
      </button>
      {open && (
        <ChartTimeZoneMenu
          anchorRef={buttonRef}
          pickerRef={pickerRef}
          zone={zone}
          brokerUtcOffsetMinutes={brokerUtcOffsetMinutes}
          onSelect={chooseZone}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
