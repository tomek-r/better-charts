import { useLayoutEffect, type RefObject } from 'react';

/** Which edge of the anchor the popup lines up with before it is kept inside the window. */
type PopupAlignment = 'start' | 'end';

/** How a popup is lined up with its anchor, and whether it is as wide as it. */
interface PopupPlacementOptions {
  readonly alignment?: PopupAlignment;
  /** Makes the popup at least as wide as its anchor, as a drop-down list is. */
  readonly matchAnchorWidth?: boolean;
}

const ANCHOR_GAP_PX = 4;
const WINDOW_MARGIN_PX = 8;

/** Keeps `value` between `low` and `high`, which every edge of the popup is clamped to. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Puts the popup under its anchor, or above it when there is no room below and more room above, and keeps
 * it inside the window with `WINDOW_MARGIN_PX` to spare. A popup that neither side can hold is the last
 * resort: it takes the roomier side's room and scrolls its content, so the buttons at its bottom stay
 * reachable instead of hanging below the window's edge, unclickable.
 */
function placePopup(
  anchor: HTMLElement,
  popup: HTMLElement,
  { alignment = 'start', matchAnchorWidth = false }: PopupPlacementOptions,
): void {
  const anchorRect = anchor.getBoundingClientRect();
  if (matchAnchorWidth) {
    popup.style.minWidth = `${anchorRect.width}px`;
  }
  const { offsetWidth: width, offsetHeight: height } = popup;
  const windowHeight = window.innerHeight;
  const roomBelow = windowHeight - anchorRect.bottom - ANCHOR_GAP_PX - WINDOW_MARGIN_PX;
  const roomAbove = anchorRect.top - ANCHOR_GAP_PX - WINDOW_MARGIN_PX;
  const opensAbove = height > roomBelow && roomAbove > roomBelow;
  // The cap comes from the room the roomier side offers, never from the popup's own height: a popup
  // capped in one pass measures exactly that cap in the next, so reading the height back would lift the
  // cap and the popup would grow and shrink on every pass.
  const cappedHeight = Math.floor(Math.max(0, roomBelow, roomAbove));
  const capped = height >= cappedHeight;
  const shownHeight = capped ? cappedHeight : height;
  const top = opensAbove ? anchorRect.top - ANCHOR_GAP_PX - shownHeight : anchorRect.bottom + ANCHOR_GAP_PX;
  const preferredLeft = alignment === 'end' ? anchorRect.right - width : anchorRect.left;
  const rightmostLeft = window.innerWidth - width - WINDOW_MARGIN_PX;
  popup.toggleAttribute('data-capped', capped);
  popup.dataset.placement = opensAbove ? 'above' : 'below';
  popup.style.maxHeight = capped ? `${cappedHeight}px` : '';
  popup.style.top = `${clamp(top, WINDOW_MARGIN_PX, windowHeight - shownHeight - WINDOW_MARGIN_PX)}px`;
  popup.style.left = `${clamp(preferredLeft, WINDOW_MARGIN_PX, rightmostLeft)}px`;
}

/**
 * Keeps a `position: fixed` popup next to its anchor and inside the window for as long as the calling
 * component is mounted. The position is written to the element before paint, so the popup never shows at a
 * stale spot, and it is re-placed when the window is resized, when any ancestor scrolls, and when the popup
 * itself changes size — a picker that opens its colour editor grows under its own anchor.
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
    const sizeChanges = new ResizeObserver(place);
    sizeChanges.observe(popup);
    return () => {
      sizeChanges.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, popupRef, alignment, matchAnchorWidth]);
}
