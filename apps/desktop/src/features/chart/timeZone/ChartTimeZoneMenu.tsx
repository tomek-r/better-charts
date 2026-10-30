import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useEscapeDismissal, useOutsidePointerDismissal } from '../../../shared/ui/popup/useDismissal';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import { chartTimeZoneOptions, EXCHANGE_TIME_ZONE } from './chartTimeZones';

const WAITING_FOR_OFFSET_TITLE = "Waiting for the broker's UTC offset";

/** The menu's selectable rows, in the order the menu shows them. */
function menuRows(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'));
}

/** Focuses the row `offset` places from `from`, wrapping around both ends. */
function focusRow(menu: HTMLElement, from: EventTarget, offset: number): void {
  const rows = menuRows(menu);
  const index = rows.findIndex((row) => row === from);
  if (index < 0) {
    return;
  }
  rows[(index + offset + rows.length) % rows.length].focus();
}

/** Focuses the first or the last selectable row, as Home and End ask. */
function focusEdge(menu: HTMLElement, edge: 'first' | 'last'): void {
  const rows = menuRows(menu);
  (edge === 'first' ? rows[0] : rows.at(-1))?.focus();
}

/**
 * The default focus target of an opened menu: the row of the zone on screen, or the first
 * selectable row when that zone's row is waiting for the broker's offset and cannot take focus.
 */
function rowToFocusOnOpen(menu: HTMLElement): HTMLButtonElement | undefined {
  return (
    menu.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)') ??
    menuRows(menu)[0]
  );
}

interface ChartTimeZoneMenuProps {
  /** The button the menu hangs from: it is placed against the button and gets the focus back on Escape. */
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  /** The button and the menu together: a press outside both closes the menu. */
  readonly pickerRef: RefObject<HTMLDivElement | null>;
  readonly zone: string;
  /** The broker's UTC offset in minutes; null until the bridge reports one. */
  readonly brokerUtcOffsetMinutes: number | null;
  readonly onSelect: (zone: string) => void;
  readonly onClose: () => void;
}

/**
 * The time zone list: UTC, the exchange, then the cities under the offset each is running at the
 * moment the menu opened. A city needs the broker's offset to be read at all, so without it only
 * the exchange can be chosen.
 */
export function ChartTimeZoneMenu({
  anchorRef,
  pickerRef,
  zone,
  brokerUtcOffsetMinutes,
  onSelect,
  onClose,
}: ChartTimeZoneMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // One snapshot of the offsets, taken when the menu opens: a list that reshuffled while the
  // pointer travelled down it would be unreadable.
  const [options] = useState(() => chartTimeZoneOptions(Date.now()));
  usePopupPlacement(anchorRef, menuRef, { alignment: 'end' });
  useOutsidePointerDismissal(pickerRef, onClose);
  const escapeToAnchor = useCallback(() => {
    anchorRef.current?.focus();
    onClose();
  }, [anchorRef, onClose]);
  useEscapeDismissal(escapeToAnchor);

  useEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const target = rowToFocusOnOpen(menu);
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(menu, event.target, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusEdge(menu, event.key === 'Home' ? 'first' : 'last');
    }
  };

  return (
    <div
      ref={menuRef}
      className="popup-surface chart-time-zone-menu"
      role="menu"
      aria-label="Time zone"
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const isChecked = option.zone === zone;
        const needsBrokerOffset = option.zone !== EXCHANGE_TIME_ZONE && brokerUtcOffsetMinutes === null;
        return (
          <button
            key={option.zone}
            role="menuitemradio"
            aria-checked={isChecked}
            className={
              isChecked ? 'popup-menu-row chart-time-zone-option active' : 'popup-menu-row chart-time-zone-option'
            }
            disabled={needsBrokerOffset}
            title={needsBrokerOffset ? WAITING_FOR_OFFSET_TITLE : undefined}
            onClick={() => onSelect(option.zone)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
