import {
  TIMEFRAME_COUNTS,
  type DrawingTimeframeVisibility,
  type TimeframeCountFamily,
} from '../../../chart/engine/drawings/timeframeVisibility';
import { SnappingRangeSlider } from './SnappingRangeSlider';
import { TimeframeCountField } from './TimeframeCountField';

/** What the Visibility tab shows of a drawing's timeframe setting and the one way to change it. */
export interface TimeframeVisibilityEditing {
  readonly value: DrawingTimeframeVisibility;
  readonly onChange: (next: DrawingTimeframeVisibility) => void;
}

type SingleTimeframe = 'days' | 'weeks' | 'months';

const COUNT_ROWS: readonly { readonly family: TimeframeCountFamily; readonly title: string }[] = [
  { family: 'minutes', title: 'Minutes' },
  { family: 'hours', title: 'Hours' },
];

const SINGLE_ROWS: readonly { readonly flag: SingleTimeframe; readonly title: string }[] = [
  { flag: 'days', title: 'Days' },
  { flag: 'weeks', title: 'Weeks' },
  { flag: 'months', title: 'Months' },
];

interface CountRangeRowProps extends TimeframeVisibilityEditing {
  readonly family: TimeframeCountFamily;
  readonly title: string;
}

/** Minutes or hours: a checkbox, the first count, a snapping two-thumb slider and the last count. */
function CountRangeRow({ family, title, value, onChange }: CountRangeRowProps) {
  const range = value[family];
  const stops = TIMEFRAME_COUNTS[family];
  const setRange = (from: number, to: number) => onChange({ ...value, [family]: { ...range, from, to } });
  return (
    <div className="drawing-settings-range-row" role="group" aria-label={title}>
      <label className="drawing-settings-range-title">
        <input
          className="drawing-settings-checkbox"
          type="checkbox"
          checked={range.shown}
          onChange={(event) => onChange({ ...value, [family]: { ...range, shown: event.target.checked } })}
        />
        {title}
      </label>
      <TimeframeCountField
        family={family}
        label={`${title} from`}
        value={range.from}
        disabled={!range.shown}
        onCommit={(count) => setRange(Math.min(count, range.to), range.to)}
      />
      <SnappingRangeSlider
        label={title}
        stops={stops}
        from={range.from}
        to={range.to}
        disabled={!range.shown}
        onChange={setRange}
      />
      <TimeframeCountField
        family={family}
        label={`${title} to`}
        value={range.to}
        disabled={!range.shown}
        onCommit={(count) => setRange(range.from, Math.max(count, range.from))}
      />
    </div>
  );
}

/**
 * The Visibility tab: on which MT5 timeframes the drawing paints. Minutes and hours carry a range of
 * their counts; MT5 has one day, week and month timeframe, so those are plain checkboxes.
 */
export function VisibilityTab({ value, onChange }: TimeframeVisibilityEditing) {
  return (
    <div className="drawing-settings-range-list">
      {COUNT_ROWS.map(({ family, title }) => (
        <CountRangeRow key={family} family={family} title={title} value={value} onChange={onChange} />
      ))}
      {SINGLE_ROWS.map(({ flag, title }) => (
        <label key={flag} className="drawing-settings-range-title">
          <input
            className="drawing-settings-checkbox"
            type="checkbox"
            checked={value[flag]}
            onChange={(event) => onChange({ ...value, [flag]: event.target.checked })}
          />
          {title}
        </label>
      ))}
    </div>
  );
}
