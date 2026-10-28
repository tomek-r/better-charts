import type { RefObject } from 'react';
import type { SizingModeMenuItem } from './unitsModeCopy';
import type { UnitsMode } from './unitsMode';

/** The sizing-mode menu list: one radio item per mode, ArrowUp/ArrowDown cycle focus. */
export function SizingModeMenu({
  menuRef,
  items,
  unitsMode,
  onSelect,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  items: readonly SizingModeMenuItem[];
  unitsMode: UnitsMode;
  onSelect: (mode: UnitsMode) => void;
}) {
  return (
    <div
      className="ticket-menu"
      role="menu"
      aria-label="Sizing mode"
      ref={menuRef}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
          return;
        }
        event.preventDefault();
        const focusable = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? [],
        );
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        let next = index - 1;
        if (event.key === 'ArrowDown') {
          next = (index + 1) % focusable.length;
        } else if (index <= 0) {
          next = focusable.length - 1;
        }
        focusable[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.mode}
          type="button"
          role="menuitemradio"
          aria-checked={unitsMode === item.mode}
          className={`ticket-menu-item${unitsMode === item.mode ? ' selected' : ''}`}
          onClick={() => onSelect(item.mode)}
        >
          <span>{item.label}</span>
          <span
            className="ticket-menu-info"
            title={item.infoTitle}
            aria-label={item.infoAria}
            onClick={(event) => event.stopPropagation()}
          >
            i
          </span>
        </button>
      ))}
    </div>
  );
}
