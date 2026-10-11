import { useEffect, useRef, type KeyboardEvent } from 'react';
import { volumeWithUnit } from '../../shared/format';
import { PARTIAL_CLOSE_PERCENTS, presetVolume, type PartialCloseLimits } from './partialCloseVolume';

interface PartialCloseMenuProps {
  limits: PartialCloseLimits;
  onClosePart: (volume: string) => void;
  onCustomVolume: () => void;
}

/** Preset percentages (rounded to the lot step; invalid ones are omitted) plus `Custom volume…`. */
export function PartialCloseMenu({ limits, onClosePart, onCustomVolume }: PartialCloseMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + offset + items.length) % items.length]?.focus();
  };

  return (
    <div
      className="ticket-menu partial-menu"
      role="menu"
      aria-label="Close part of position"
      ref={menuRef}
      onKeyDown={moveFocus}
    >
      {PARTIAL_CLOSE_PERCENTS.map((percent) => {
        const volume = presetVolume(limits, percent);
        return (
          volume && (
            <button
              key={percent}
              type="button"
              role="menuitem"
              className="ticket-menu-item"
              onClick={() => onClosePart(volume)}
            >
              <span>Close {percent}%</span>
              <span className="partial-menu-lots">{volumeWithUnit(volume)}</span>
            </button>
          )
        );
      })}
      <div className="partial-menu-separator" role="separator" />
      <button type="button" role="menuitem" className="ticket-menu-item" onClick={onCustomVolume}>
        Custom volume…
      </button>
    </div>
  );
}
