import type { KeyboardEvent } from 'react';
import { clampUnit, hsvToHex } from '../../../theme/colorSpace';
import { dragHandlers, type PointerPoint } from './dragHandlers';

const PERCENT = 100;
const FINE_STEP = 1 / PERCENT;
const COARSE_STEP = 10 / PERCENT;

interface SaturationValueSquareProps {
  /** The hue of the backdrop; the square itself moves the colour's saturation and value. */
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
  /** Called with the saturation and brightness under the pointer or arrow keys, both 0..1. */
  readonly onChange: (saturation: number, value: number) => void;
}

/** Saturation to the right and brightness upwards over the hue, with a white-ringed handle on the colour. */
export function SaturationValueSquare({ hue, saturation, value, onChange }: SaturationValueSquareProps) {
  const saturationPercent = Math.round(saturation * PERCENT);
  const valuePercent = Math.round(value * PERCENT);

  const applyPoint = (point: PointerPoint) => onChange(point.x, 1 - point.y);
  const nudge = (across: number, up: number) => onChange(clampUnit(saturation + across), clampUnit(value + up));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? COARSE_STEP : FINE_STEP;
    if (event.key === 'ArrowLeft') {
      nudge(-step, 0);
    } else if (event.key === 'ArrowRight') {
      nudge(step, 0);
    } else if (event.key === 'ArrowUp') {
      nudge(0, step);
    } else if (event.key === 'ArrowDown') {
      nudge(0, -step);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      className="color-editor-square"
      style={{ backgroundColor: hsvToHex(hue, 1, 1) }}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={saturationPercent}
      aria-valuetext={`saturation ${saturationPercent}%, brightness ${valuePercent}%`}
      onKeyDown={handleKeyDown}
      {...dragHandlers(applyPoint)}
    >
      <span
        className="color-editor-handle"
        style={{ left: `${saturation * PERCENT}%`, top: `${(1 - value) * PERCENT}%` }}
      />
    </div>
  );
}
