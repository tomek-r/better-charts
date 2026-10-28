import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const MENU_ITEM_SELECTOR = '[role="menuitemradio"]';
const CHECKED_MENU_ITEM_SELECTOR = `${MENU_ITEM_SELECTOR}[aria-checked="true"]`;

/**
 * The open/close behavior of the tool rail's flyouts. Opening a flyout moves focus into it (the checked
 * row, else the first), a mousedown outside the rail closes it, and Escape closes it, returns focus to
 * the group's icon and takes the reveal of the group's arrow tab away with it.
 */
export function useRailFlyout(railRef: RefObject<HTMLElement | null>) {
  /** The group whose flyout is open, if any. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  /**
   * The group whose arrow tab is showing. The pointer reveals it and takes it away again on leave;
   * Escape clears it explicitly, because the pointer is usually still resting on the tab it just
   * clicked and CSS :hover would keep the chevron on screen after the menu it belongs to is gone.
   */
  const [revealedGroupId, setRevealedGroupId] = useState<string | null>(null);
  /** Each group's icon button: Escape hands focus back to the open group's. */
  const headRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const closeFlyout = useCallback(() => {
    setOpenGroupId(null);
  }, []);
  const toggleFlyout = useCallback((groupId: string) => {
    setOpenGroupId((open) => (open === groupId ? null : groupId));
  }, []);
  const registerHead = useCallback((groupId: string, element: HTMLButtonElement | null) => {
    headRefs.current.set(groupId, element);
  }, []);

  useEffect(() => {
    if (openGroupId === null) {
      return;
    }
    const onPointerDownOutside = (event: MouseEvent) => {
      if (!railRef.current?.contains(event.target as Node)) {
        setOpenGroupId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // The menu owns this Escape: stopping propagation keeps the chart's own
      // Escape (deselect the active tool / unstage a draft) from also running.
      event.stopPropagation();
      setOpenGroupId(null);
      setRevealedGroupId(null);
      headRefs.current.get(openGroupId)?.focus();
    };
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('keydown', onKeyDown);
    const checked = railRef.current?.querySelector<HTMLElement>(CHECKED_MENU_ITEM_SELECTOR);
    const first = railRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR);
    (checked ?? first)?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openGroupId, railRef]);

  return { openGroupId, revealedGroupId, setRevealedGroupId, closeFlyout, toggleFlyout, registerHead };
}
