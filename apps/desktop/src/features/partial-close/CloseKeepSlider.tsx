import type { CSSProperties } from 'react';
import { formatVolume, volumeWithUnit } from '../../shared/format';
import {
  remainingVolume,
  sliderPositionVolume,
  snapSliderMove,
  volumeSliderPosition,
  volumeSliderScale,
  type PartialCloseLimits,
} from './partialCloseVolume';

interface CloseKeepSliderProps {
  limits: PartialCloseLimits;
  /** A valid volume (accepted by checkPartialVolume); the slider is a view of it. */
  closed: string;
  onChange: (volume: string) => void;
}

/** Draggable close/keep bar: a native range input (keyboard and a11y for free) styled as the two-part bar. */
export function CloseKeepSlider({ limits, closed, onChange }: CloseKeepSliderProps) {
  const scale = volumeSliderScale(limits);
  const position = volumeSliderPosition(limits, closed);
  if (!scale || position === undefined) {
    return null;
  }
  // The fill is measured along the thumb's travel, so it ends under the thumb rather than at the volume share.
  const fillRatio = scale.max === scale.min ? 0 : (position - scale.min) / (scale.max - scale.min);

  return (
    <div className="partial-bar-group">
      <input
        type="range"
        className="partial-slider"
        aria-label="Close volume"
        aria-valuetext={`Close ${formatVolume(closed)} of ${volumeWithUnit(limits.volume)}`}
        min={scale.min}
        max={scale.max}
        step={1}
        value={position}
        style={{ '--partial-fill-ratio': fillRatio } as CSSProperties}
        onChange={(event) =>
          onChange(sliderPositionVolume(limits, snapSliderMove(limits, position, event.currentTarget.valueAsNumber)))
        }
      />
      <div className="partial-bar-labels">
        <span>Close {formatVolume(closed)}</span>
        <span>Keep {formatVolume(remainingVolume(limits, closed))}</span>
      </div>
    </div>
  );
}
