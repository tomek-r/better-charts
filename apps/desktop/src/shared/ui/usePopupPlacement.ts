import { useLayoutEffect, type RefObject } from 'react';

/** Which edge of the anchor the popup lines up with before it is kept inside the window. */
export type PopupAlignment = 'start' | 'end';

export interface PopupPlacementOptions {
  readonly alignment?: PopupAlignment;
  /** Makes the popup at least as wide as its anchor, as a drop-down list is. */
  readonly matchAnchorWidth?: boolean;
}

const ANCHOR_GAP_PX = 4;
const WINDOW_MARGIN_PX = 8;

/** Puts the popup under its anchor, or above it when there is no room below and more room above. */
function placePopup(
  anchor: HTMLElement,
  popup: HTMLElement,
  { alignment = 'start', matchAnchorWidth = false }: PopupPlacementOptions,
) {
  const anchorRect = anchor.getBoundingClientRect();
  if (matchAnchorWidth) {
    popup.style.minWidth = `${anchorRect.width}px`;
  }
  const { offsetWidth: width, offsetHeight: height } = popup;
  const roomBelow = window.innerHeight - anchorRect.bottom - ANCHOR_GAP_PX - WINDOW_MARGIN_PX;
  const roomAbove = anchorRect.top - ANCHOR_GAP_PX - WINDOW_MARGIN_PX;
  const opensAbove = height > roomBelow && roomAbove > roomBelow;
  const preferredLeft = alignment === 'end' ? anchorRect.right - width : anchorRect.left;
  const rightmostLeft = window.innerWidth - width - WINDOW_MARGIN_PX;
  popup.style.top = `${opensAbove ? anchorRect.top - ANCHOR_GAP_PX - height : anchorRect.bottom + ANCHOR_GAP_PX}px`;
  popup.style.left = `${Math.min(Math.max(WINDOW_MARGIN_PX, preferredLeft), rightmostLeft)}px`;
  popup.dataset.placement = opensAbove ? 'above' : 'below';
}

/**
 * Keeps a `position: fixed` popup next to its anchor for as long as the calling component is mounted. The
 * position is written to the element before paint, so the popup never shows at a stale spot, and it
 * follows the window being resized or any ancestor scrolling.
 */
export function usePopupPlacement(
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  options: PopupPlacementOptions = {},
): void {
  const { alignment, matchAnchorWidth } = options;
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (anchor === null || popup === null) {
      return undefined;
    }
    const place = () => placePopup(anchor, popup, { alignment, matchAnchorWidth });
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, popupRef, alignment, matchAnchorWidth]);
}
