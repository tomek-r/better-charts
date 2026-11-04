import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  focusEndRow,
  focusSiblingRow,
  MENU_SUBMENU_CLASS,
  menuRows,
  type SubmenuOpening,
} from './scalesAndLinesMenuRows';

/** Room kept between a submenu and the chart frame's edges, as the panel that holds the menu keeps. */
const FRAME_EDGE_PX = 8;

/** Where the submenu is drawn, in the pixels of the panel that holds the menu. */
interface SubmenuOrigin {
  readonly left: number;
  readonly top: number;
}

/** Keeps `value` between the two bounds, which every edge of the submenu is held to. */
function clampBetween(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Where the submenu goes: beside the row that opened it, to the right of the menu where the chart frame has
 * the room and to its left otherwise — the gear sits at the frame's right edge, so normally to the left — top
 * aligned with the row and kept inside the frame. A submenu no side of the frame can hold keeps the edge it
 * was clamped to, which is the most of it the frame can show.
 */
function submenuOrigin(submenu: HTMLElement, row: HTMLElement): SubmenuOrigin | undefined {
  const panel = submenu.offsetParent;
  if (!(panel instanceof HTMLElement)) {
    return undefined;
  }
  const frame = panel.offsetParent;
  if (!(frame instanceof HTMLElement)) {
    return undefined;
  }
  const frameBox = frame.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  // The rows are the menu's own children, so their parent's box is the menu's: the submenu's edge meets it.
  const menuBox = (row.parentElement ?? row).getBoundingClientRect();
  const roomRight = frameBox.right - menuBox.right - submenu.offsetWidth - FRAME_EDGE_PX;
  const besideMenu = roomRight >= 0 ? menuBox.right : menuBox.left - submenu.offsetWidth;
  const leftmost = frameBox.left - panelBox.left + FRAME_EDGE_PX;
  const rightmost = frameBox.right - panelBox.left - submenu.offsetWidth - FRAME_EDGE_PX;
  const topmost = frameBox.top - panelBox.top + FRAME_EDGE_PX;
  const bottommost = frameBox.bottom - panelBox.top - submenu.offsetHeight - FRAME_EDGE_PX;
  return {
    left: clampBetween(besideMenu - panelBox.left, leftmost, rightmost),
    top: clampBetween(rowBox.top - panelBox.top, topmost, bottommost),
  };
}

interface ScalesAndLinesSubmenuProps {
  /** The row's label, which names the submenu for the keyboard and for assistive tech. */
  readonly label: string;
  /** The row it hangs beside: the submenu is placed against it and gives it the focus back when it closes. */
  readonly row: HTMLButtonElement;
  /** How the submenu was opened: the pointer's hover leaves the focus on the row, an activation moves it in. */
  readonly opening: SubmenuOpening;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * The rows a row of the Scales and lines menu opens: a menu of its own, drawn inside the menu's panel so that
 * an outside press closes the menu and its submenu together.
 */
export function ScalesAndLinesSubmenu({ label, row, opening, onClose, children }: ScalesAndLinesSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<SubmenuOrigin>();

  useLayoutEffect(() => {
    const submenu = submenuRef.current;
    if (submenu === null) {
      return undefined;
    }
    const place = () => {
      const next = submenuOrigin(submenu, row);
      if (next !== undefined) {
        setOrigin(next);
      }
    };
    place();
    // The box is measured once its rows are laid out, and again if it changes size, so it stays beside its row.
    const sizeChanges = new ResizeObserver(place);
    sizeChanges.observe(submenu);
    return () => sizeChanges.disconnect();
  }, [row]);

  // A press or a key opens the submenu, so its first row takes the focus and the arrow keys walk it straight
  // away; the pointer's hover opens it where it stands, leaving the focus on the row the pointer came from.
  useEffect(() => {
    if (opening === 'hover') {
      return;
    }
    menuRows(submenuRef.current).at(0)?.focus();
  }, [opening]);

  const closeToRow = () => {
    onClose();
    row.focus();
  };

  /** The keys of the rows inside: Left and Escape close the submenu alone, back to the row that opened it. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      focusSiblingRow(submenuRef.current, event.target, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      focusEndRow(submenuRef.current, event.key === 'Home' ? 'first' : 'last');
    } else if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      closeToRow();
    } else {
      return;
    }
    // The menu around the submenu leaves these keys to the submenu: Escape on one of its rows closes the
    // submenu, not the menu it hangs in.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={submenuRef}
      className={`ticket-menu ${MENU_SUBMENU_CLASS}`}
      role="menu"
      aria-label={label}
      style={origin}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
