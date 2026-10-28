import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatVolume } from '../../shared/format';
import { CloseKeepSlider } from './CloseKeepSlider';
import {
  PARTIAL_CLOSE_PERCENTS,
  checkPartialVolume,
  fullVolume,
  partialVolumeMessage,
  presetVolume,
  type PartialCloseLimits,
} from '../../shared/trading/partialCloseVolume';
import { useEscapeDismissal } from '../../shared/ui/popup/useDismissal';
import { VolumeStepper } from './VolumeStepper';

interface PartialCloseVolumePopoverProps {
  /** e.g. `Close part of EURUSD BUY`. */
  title: string;
  limits: PartialCloseLimits;
  /** `null` = close the whole position (the volume field holds the full volume). */
  onConfirm: (volume: string | null) => void;
  onDismiss: () => void;
}

/** Custom volume form: stepper, shortcut chips, close/keep bar, validation and Cancel / Close. */
export function PartialCloseVolumePopover({ title, limits, onConfirm, onDismiss }: PartialCloseVolumePopoverProps) {
  const [value, setValue] = useState(() => presetVolume(limits, 50) ?? formatVolume(limits.min));
  const formRef = useRef<HTMLFormElement>(null);
  useEscapeDismissal(onDismiss);
  // The popover floats below its anchor inside a scrolling drawer; for the last row it extends
  // the drawer's scroll area rather than being clipped, so bring it into view when it opens.
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const check = checkPartialVolume(limits, value);
  const message = check.ok ? undefined : partialVolumeMessage(check.issue, limits);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (check.ok) {
      onConfirm(check.closesAll ? null : check.volume);
    }
  };

  return (
    <form ref={formRef} className="partial-popover" aria-label={title} onSubmit={submit}>
      <div className="partial-popover-header">
        <strong>{title}</strong>
        <button type="button" className="partial-dismiss" aria-label="Dismiss partial close" onClick={onDismiss}>
          ✕
        </button>
      </div>
      <VolumeStepper limits={limits} value={value} onChange={setValue} />
      <div className="partial-chips">
        {PARTIAL_CLOSE_PERCENTS.map((percent) => {
          const volume = presetVolume(limits, percent);
          return (
            <button
              key={percent}
              type="button"
              className="action-button"
              disabled={volume === undefined}
              onClick={() => volume && setValue(volume)}
            >
              {percent}%
            </button>
          );
        })}
        <button type="button" className="action-button" onClick={() => setValue(fullVolume(limits))}>
          All
        </button>
      </div>
      {check.ok ? (
        <CloseKeepSlider limits={limits} closed={check.volume} onChange={setValue} />
      ) : (
        message && (
          <p className="error-text partial-error" role="alert">
            {message}
          </p>
        )
      )}
      <div className="partial-actions">
        <button type="button" className="action-button" onClick={onDismiss}>
          Cancel
        </button>
        <button type="submit" className="action-button" disabled={!check.ok}>
          Close
        </button>
      </div>
    </form>
  );
}
