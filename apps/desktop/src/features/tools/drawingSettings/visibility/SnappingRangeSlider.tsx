export interface SnappingRangeSliderProps {
  /** Names the two thumbs for assistive technology, e.g. `Minutes`. */
  readonly label: string;
  /** The values the thumbs can rest on, ascending; the slider steps over their indexes, so it snaps. */
  readonly stops: readonly number[];
  readonly from: number;
  readonly to: number;
  readonly disabled: boolean;
  readonly onChange: (from: number, to: number) => void;
}

/** The percentage of the track where the stop at `index` sits. */
function percentAt(index: number, lastIndex: number): number {
  return lastIndex === 0 ? 0 : (index / lastIndex) * 100;
}

interface RangeThumbProps {
  readonly thumb: 'from' | 'to';
  readonly ariaLabel: string;
  readonly lastIndex: number;
  readonly index: number;
  /** The stop the thumb rests on, which assistive technology reads instead of the index. */
  readonly valueText: number;
  readonly disabled: boolean;
  readonly onIndexChange: (index: number) => void;
}

/** One thumb of the slider: a range input over the stop indexes. */
function RangeThumb({ thumb, ariaLabel, lastIndex, index, valueText, disabled, onIndexChange }: RangeThumbProps) {
  return (
    <input
      className="drawing-settings-range-thumb"
      data-thumb={thumb}
      type="range"
      min={0}
      max={lastIndex}
      step={1}
      value={index}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuetext={String(valueText)}
      onChange={(event) => onIndexChange(Number(event.target.value))}
    />
  );
}

/**
 * Two overlaid range inputs over the indexes of `stops`: each thumb rests on a stop only, and the thumbs
 * cannot cross, because a thumb is clamped to the other one.
 */
export function SnappingRangeSlider({ label, stops, from, to, disabled, onChange }: SnappingRangeSliderProps) {
  const lastIndex = stops.length - 1;
  const fromIndex = Math.max(0, stops.indexOf(from));
  const toIndex = Math.max(0, stops.indexOf(to));
  // The thumb on top is the one that can still move away when both rest together at an end.
  const front = fromIndex > lastIndex / 2 ? 'from' : 'to';
  return (
    <div className="drawing-settings-range-slider" data-front={front} data-disabled={disabled}>
      <span className="drawing-settings-range-track" aria-hidden="true">
        <span
          className="drawing-settings-range-fill"
          style={{ left: `${percentAt(fromIndex, lastIndex)}%`, right: `${100 - percentAt(toIndex, lastIndex)}%` }}
        />
      </span>
      <RangeThumb
        thumb="from"
        ariaLabel={`${label} range minimum`}
        lastIndex={lastIndex}
        index={fromIndex}
        valueText={from}
        disabled={disabled}
        onIndexChange={(index) => onChange(stops[Math.min(index, toIndex)], to)}
      />
      <RangeThumb
        thumb="to"
        ariaLabel={`${label} range maximum`}
        lastIndex={lastIndex}
        index={toIndex}
        valueText={to}
        disabled={disabled}
        onIndexChange={(index) => onChange(from, stops[Math.max(index, fromIndex)])}
      />
    </div>
  );
}
