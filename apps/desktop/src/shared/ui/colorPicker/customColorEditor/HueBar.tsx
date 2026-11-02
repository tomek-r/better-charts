import type { KeyboardEvent } from 'react';
import { clampHue } from '../../../theme/colorSpace';
import { dragHandlers } from './dragHandlers';

const HUE_CIRCLE = 360;
const PERCENT = 100;
const FINE_STEP = 1;
const COARSE_STEP = 10;

interface HueBarProps {
  readonly hue: number;
  /** Called with the hue under the pointer or arrow keys, 0..360. */
  readonly onChange: (hue: number) => void;
}

/** The hue wheel as a vertical bar, red at both ends, with a full-width handle on the chosen hue. */
export function HueBar({ hue, onChange }: HueBarProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? COARSE_STEP : FINE_STEP;
    if (event.key === 'ArrowUp') {
      onChange(clampHue(hue + step));
    } else if (event.key === 'ArrowDown') {
      onChange(clampHue(hue - step));
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      className="color-editor-hue"
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={HUE_CIRCLE}
      aria-valuenow={Math.round(hue)}
      onKeyDown={handleKeyDown}
      {...dragHandlers((point) => onChange(clampHue(point.y * HUE_CIRCLE)))}
    >
      <span className="color-editor-hue-handle" style={{ top: `${(hue / HUE_CIRCLE) * PERCENT}%` }} />
    </div>
  );
}
