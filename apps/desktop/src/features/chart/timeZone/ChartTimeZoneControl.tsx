import { useCallback, useMemo, useRef, useState } from 'react';
import { createChartTimeFormat } from './chartTimeFormat';
import { ChartTimeZoneMenu } from './ChartTimeZoneMenu';
import { createTauriChartTimeZoneStore, type ChartTimeZoneStore } from './chartTimeZoneStore';
import { useChartClock } from './useChartClock';
import { useChartTimeZone } from './useChartTimeZone';

/** The label the button falls back to while the zone has no clock of its own. */
const EXCHANGE_BUTTON_LABEL = 'Exchange';

/**
 * The live clock of the chart's time zone, under the chart's right corner; clicking it opens the
 * zone list. The zone belongs to this chart (one account and one symbol) and is restored with it.
 */
export function ChartTimeZoneControl() {
  // One store for the lifetime of the chart, like the drawings', so the hook never reloads on a render.
  const [store] = useState<ChartTimeZoneStore>(createTauriChartTimeZoneStore);
  const { zone, brokerUtcOffsetMinutes, selectZone } = useChartTimeZone(store);
  const format = useMemo(() => createChartTimeFormat(zone, brokerUtcOffsetMinutes), [brokerUtcOffsetMinutes, zone]);
  const clock = useChartClock(format);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const chooseZone = useCallback(
    (next: string) => {
      setOpen(false);
      selectZone(next);
    },
    [selectZone],
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
