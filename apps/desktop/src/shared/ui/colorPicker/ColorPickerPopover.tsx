import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { withAlphaOf } from '../../theme/hexColor';
import { useOutsidePress } from '../useOutsidePress';
import { usePopupPlacement } from '../usePopupPlacement';
import { ColorGrid } from './ColorGrid';
import { CustomColors } from './CustomColors';
import { addCustomColor, loadCustomColors, saveCustomColors } from './savedCustomColors';
import { LineOptionsSection, type LineOptions } from './LineOptionsSection';
import { OpacityControl } from './OpacityControl';

// The hidden native colour input is reached through the "+" button, so it stays out of the tab order.
const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled):not([tabindex="-1"])';

interface ColorPickerPopoverProps {
  /** Names the dialog: `${label} options`. */
  readonly label: string;
  /** The colour in use, `#rrggbb` or `#rrggbbaa`. */
  readonly color: string;
  readonly onColorChange: (color: string) => void;
  /** Present for a line, which then also offers thickness and line style. */
  readonly line?: LineOptions;
  readonly id: string;
  readonly anchorRef: RefObject<HTMLElement | null>;
  /** Closes the popover; `returnFocus` is false when the user pressed elsewhere and focus should stay there. */
  readonly onClose: (returnFocus: boolean) => void;
}

/** Wraps Tab and Shift+Tab inside the popover, so focus never leaves it while it is open. */
function trapTab(event: KeyboardEvent<HTMLElement>): void {
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * The picker's panel: preset colours, the user's own colours, opacity and, for a line, thickness and line
 * style. Every change goes straight to `onColorChange` and the line callbacks; nothing here is saved
 * except the custom colours. It is portalled to the page body so no ancestor's overflow clips it.
 */
export function ColorPickerPopover({
  label,
  color,
  onColorChange,
  line,
  id,
  anchorRef,
  onClose,
}: ColorPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [customColors, setCustomColors] = useState(loadCustomColors);
  usePopupPlacement(anchorRef, popoverRef);
  useOutsidePress(popoverRef, anchorRef, () => onClose(false));

  useEffect(() => {
    const popover = popoverRef.current;
    const pressed = popover?.querySelector<HTMLElement>('.color-swatch[aria-pressed="true"]');
    (pressed ?? popover?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
  }, []);

  // A picked colour keeps the opacity chosen so far; opacity is its own control.
  const pick = (picked: string) => onColorChange(withAlphaOf(picked, color));
  const addCustom = useCallback(
    (added: string) => {
      const next = addCustomColor(customColors, added);
      setCustomColors(next);
      saveCustomColors(next);
      onColorChange(withAlphaOf(added, color));
    },
    [customColors, color, onColorChange],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose(true);
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className="color-popover popup-surface"
      role="dialog"
      aria-label={`${label} options`}
      onKeyDown={handleKeyDown}
    >
      <ColorGrid current={color} onPick={pick} />
      <hr className="color-divider" />
      <span className="color-section-title">Custom colours</span>
      <CustomColors colors={customColors} current={color} onPick={pick} onAdd={addCustom} />
      <hr className="color-divider" />
      <OpacityControl color={color} onChange={onColorChange} />
      {line ? <LineOptionsSection {...line} /> : null}
    </div>,
    document.body,
  );
}
