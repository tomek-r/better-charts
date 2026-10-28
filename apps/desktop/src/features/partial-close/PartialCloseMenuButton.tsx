import { useCallback, useRef, useState } from 'react';
import { CaretIcon } from '../../shared/ui/icons/CaretIcon';
import { PartialCloseMenu } from './PartialCloseMenu';
import type { PartialCloseLimits } from '../../shared/trading/partialCloseVolume';
import { useEscapeDismissal, useOutsidePointerDismissal } from '../../shared/hooks/useDismissal';

interface PartialCloseMenuButtonProps {
  limits: PartialCloseLimits;
  disabled: boolean;
  /** Styling hook so the host (portfolio row, chart chip) keeps its own button look. */
  className: string;
  onClosePart: (volume: string) => void;
  onCustomVolume: () => void;
}

/** The ▾ trigger and its preset menu. Independent of any host surface. */
export function PartialCloseMenuButton({
  limits,
  disabled,
  className,
  onClosePart,
  onCustomVolume,
}: PartialCloseMenuButtonProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscapeDismissal(open ? close : noop);
  useOutsidePointerDismissal(anchorRef, open ? close : noop);

  return (
    <span className="partial-menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Close part of position"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <CaretIcon className="ticket-caret" />
      </button>
      {open && !disabled && (
        <PartialCloseMenu
          limits={limits}
          onClosePart={(volume) => {
            close();
            onClosePart(volume);
          }}
          onCustomVolume={() => {
            close();
            onCustomVolume();
          }}
        />
      )}
    </span>
  );
}

function noop() {}
