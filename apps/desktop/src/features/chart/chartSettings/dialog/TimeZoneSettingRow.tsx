import { useState } from 'react';
import { useBridgeConnectionSelector } from '../../../bridge/bridgeSelectors';
import { EXCHANGE_TIME_ZONE, chartTimeZoneOptions } from '../../timeZone/chartTimeZones';
import { Select, type SelectOption } from '../../../../shared/ui/select/Select';

/** The row's visible label, which is also the select's accessible name. */
const TIME_ZONE_LABEL = 'Timezone';

/** The one zone a chart can name before the broker reports its offset: the exchange's own. */
const EXCHANGE_ONLY_OPTIONS: readonly SelectOption[] = [{ value: EXCHANGE_TIME_ZONE, label: 'Exchange' }];

/** Every zone the picker offers, or the exchange alone while the broker's offset is still unknown. */
function timeZoneOptions(brokerUtcOffsetMinutes: number | null): readonly SelectOption[] {
  if (brokerUtcOffsetMinutes === null) {
    return EXCHANGE_ONLY_OPTIONS;
  }
  return chartTimeZoneOptions(Date.now()).map((option) => ({ value: option.zone, label: option.label }));
}

/** The zone the chart draws its times in, as one row of the settings dialog. */
export function TimeZoneSettingRow({ zone, onChange }: { zone: string; onChange: (zone: string) => void }) {
  const brokerUtcOffsetMinutes = useBridgeConnectionSelector(({ status }) => status.brokerUtcOffsetMinutes) ?? null;
  // Read once, when the row mounts: a city's label carries the offset in force now, which would otherwise
  // move under the pointer when a zone crosses midnight while the dialog is open.
  const [options] = useState(() => timeZoneOptions(brokerUtcOffsetMinutes));
  return (
    <div className="chart-settings-row">
      <span className="chart-settings-label">{TIME_ZONE_LABEL}</span>
      <Select ariaLabel={TIME_ZONE_LABEL} options={options} value={zone} onChange={onChange} />
    </div>
  );
}
