import { volumeWithUnit } from '../../shared/format';
import { stepVolumeText, snapVolumeText, type PartialCloseLimits } from './partialCloseVolume';

interface VolumeStepperProps {
  limits: PartialCloseLimits;
  value: string;
  onChange: (value: string) => void;
}

/** Volume text field with − / + buttons stepping by the lot step; typed text snaps to the step on blur. */
export function VolumeStepper({ limits, value, onChange }: VolumeStepperProps) {
  return (
    <div className="partial-stepper">
      <button
        type="button"
        className="action-button"
        aria-label="Decrease volume"
        onClick={() => onChange(stepVolumeText(limits, value, -1))}
      >
        −
      </button>
      <input
        className="partial-volume-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label="Volume to close"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onChange(snapVolumeText(limits, value))}
      />
      <button
        type="button"
        className="action-button"
        aria-label="Increase volume"
        onClick={() => onChange(stepVolumeText(limits, value, 1))}
      >
        +
      </button>
      <span className="partial-of-total">of {volumeWithUnit(limits.volume)}</span>
    </div>
  );
}
