import { useId, useRef, useState } from 'react';
import { parseHexColor } from '../../theme/hexColor';
import { ColorPickerPopover } from './ColorPickerPopover';
import type { LineOptions } from './LineOptionsSection';
import { LinePreview } from './LinePreview';

/** Shown while the stored colour is unreadable, so the swatch and the picker still render. */
const FALLBACK_COLOR = '#000000';

interface ColorPickerButtonProps {
  /** Names the setting: the button's accessible name, e.g. "POC colour". */
  readonly label: string;
  readonly color: string;
  readonly onColorChange: (color: string) => void;
  /** Present for a line: the swatch then previews its colour, thickness and style, and the picker edits both. */
  readonly line?: LineOptions;
  readonly disabled?: boolean;
}

/**
 * A swatch button that opens a TradingView-style colour picker. For a line the face is a sample of the
 * line itself; for a plain colour it is the colour over a checkerboard, so its opacity shows.
 */
export function ColorPickerButton({ label, color, onColorChange, line, disabled }: ColorPickerButtonProps) {
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const invalid = parseHexColor(color) === undefined;
  const shownColor = invalid ? FALLBACK_COLOR : color;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="color-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="color-face">
          {line ? (
            <LinePreview color={shownColor} width={line.width} dash={line.dashStyle} />
          ) : (
            <span className="color-face-fill" style={{ backgroundColor: shownColor }} />
          )}
        </span>
      </button>
      {open ? (
        <ColorPickerPopover
          id={popoverId}
          label={label}
          color={shownColor}
          onColorChange={onColorChange}
          line={line}
          anchorRef={buttonRef}
          onClose={close}
        />
      ) : null}
    </>
  );
}
