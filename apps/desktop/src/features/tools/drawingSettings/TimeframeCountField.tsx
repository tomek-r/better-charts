import { useState } from 'react';
import {
  snapTimeframeCount,
  TIMEFRAME_COUNTS,
  type TimeframeCountFamily,
} from '../../chart/engine/drawings/timeframeVisibility';

export interface TimeframeCountFieldProps {
  readonly family: TimeframeCountFamily;
  /** Accessible name, e.g. `Minutes from`. */
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  readonly onCommit: (count: number) => void;
}

/**
 * A number field that only ever commits an allowed count: typing an allowed count applies it at once, and
 * any other text snaps to the nearest allowed count when the field loses focus or Enter is pressed.
 */
export function TimeframeCountField({ family, label, value, disabled, onCommit }: TimeframeCountFieldProps) {
  const [typed, setTyped] = useState<string | null>(null);

  const type = (text: string) => {
    setTyped(text);
    const count = Number(text);
    if (text.trim() !== '' && TIMEFRAME_COUNTS[family].includes(count)) {
      onCommit(count);
    }
  };
  const snap = () => {
    const count = Number(typed);
    if (typed !== null && typed.trim() !== '' && Number.isFinite(count)) {
      onCommit(snapTimeframeCount(family, count));
    }
    setTyped(null);
  };

  return (
    <input
      className="drawing-settings-control drawing-settings-range-field"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      disabled={disabled}
      value={typed ?? String(value)}
      onChange={(event) => type(event.target.value)}
      onBlur={snap}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          snap();
        }
      }}
    />
  );
}
