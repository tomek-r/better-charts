import { useMemo, useState } from 'react';
import { useBridgeConnectionSelector } from '../../../bridge/bridgeSelectors';
import { EXCHANGE_TIME_ZONE, chartTimeZoneOptions } from '../../timeZone/chartTimeZones';
import { Select, type SelectOption } from '../../../../shared/ui/select/Select';

/** The row's visible label, which is also the select's accessible name. */
const TIME_ZONE_LABEL = 'Timezone';

/** The one zone a chart can name before the broker reports its offset: the exchange's own. */
const EXCHANGE_ONLY_OPTIONS: readonly SelectOption[] = [{ value: EXCHANGE_TIME_ZONE, label: 'Exchange' }];

/** Every zone the picker offers, or the exchange alone while the broker's offset is still unknown. */
function timeZoneOptions(atMs: number, brokerUtcOffsetMinutes: number | null): readonly SelectOption[] {
  if (brokerUtcOffsetMinutes === null) {
    return EXCHANGE_ONLY_OPTIONS;
  }
  return chartTimeZoneOptions(atMs, brokerUtcOffsetMinutes).map((option) => ({
    value: option.zone,
    label: option.label,
  }));
}

/** The zone the chart draws its times in, as one row of the settings dialog. */
export function TimeZoneSettingRow({ zone, onChange }: { zone: string; onChange: (zone: string) => void }) {
  const brokerUtcOffsetMinutes = useBridgeConnectionSelector(({ status }) => status.brokerUtcOffsetMinutes) ?? null;
  // The cities' offsets are read once, when the row mounts: a label would otherwise move under the pointer
  // when a zone crosses midnight while the dialog is open. The exchange row names the broker's offset, so it
  // is rebuilt when the bridge reports that offset after the row has drawn.
  const [openedAtMs] = useState(() => Date.now());
  const options = useMemo(
    () => timeZoneOptions(openedAtMs, brokerUtcOffsetMinutes),
    [openedAtMs, brokerUtcOffsetMinutes],
  );
  return (
    <div className="chart-settings-row">
      <span>{TIME_ZONE_LABEL}</span>
      <Select ariaLabel={TIME_ZONE_LABEL} options={options} value={zone} onChange={onChange} />
    </div>
  );
}
