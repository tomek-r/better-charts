import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Room between the mark's top edge and the bubble's bottom edge. */
const BUBBLE_GAP_PX = 6;
/** Room the bubble keeps from the window's sides, so a mark near an edge still shows all of its text. */
const BUBBLE_MARGIN_PX = 8;

/** Fixes the bubble above the mark, centred on it and kept inside the window. */
function placeBubble(mark: HTMLElement, bubble: HTMLElement): void {
  const markRect = mark.getBoundingClientRect();
  const { width, height } = bubble.getBoundingClientRect();
  const centredLeft = markRect.left + markRect.width / 2 - width / 2;
  const rightmostLeft = window.innerWidth - width - BUBBLE_MARGIN_PX;
  bubble.style.left = `${Math.min(Math.max(centredLeft, BUBBLE_MARGIN_PX), rightmostLeft)}px`;
  bubble.style.top = `${Math.max(markRect.top - height - BUBBLE_GAP_PX, BUBBLE_MARGIN_PX)}px`;
}

/** Places the bubble before its first paint, so it never flashes at a stale spot. */
function useBubblePlacement(
  shown: boolean,
  markRef: RefObject<HTMLButtonElement | null>,
  bubbleRef: RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    const mark = markRef.current;
    const bubble = bubbleRef.current;
    if (!shown || mark === null || bubble === null) {
      return;
    }
    placeBubble(mark, bubble);
  }, [shown, markRef, bubbleRef]);
}

/** Hides the bubble on Escape, which reaches here because the surrounding dialog yields an expanded popup. */
function useEscapeToHide(shown: boolean, hide: () => void): void {
  useEffect(() => {
    if (!shown) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shown, hide]);
}

interface SettingTooltipMarkProps {
  /** The tooltip the input declares, which the bubble shows. */
  readonly text: string;
  /** The id of the hidden tooltip text the input's control is already described by. */
  readonly tooltipId: string;
}

/**
 * The (i) mark that follows a control: hovering or focusing it shows the input's tooltip in a small bubble
 * above it. The bubble is portalled to the page body, so the dialog's scrolling region can never clip it,
 * and it is hidden from assistive technology because the input's control already describes itself with the
 * same text. It carries `aria-haspopup` and `aria-expanded` so the dialog it sits in yields Escape to it.
 */
export function SettingTooltipMark({ text, tooltipId }: SettingTooltipMarkProps) {
  const markRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const show = useCallback(() => setShown(true), []);
  const hide = useCallback(() => setShown(false), []);
  useBubblePlacement(shown, markRef, bubbleRef);
  useEscapeToHide(shown, hide);
  return (
    <>
      <button
        ref={markRef}
        type="button"
        className="drawing-settings-info"
        aria-haspopup="true"
        aria-expanded={shown}
        aria-label="Info"
        aria-describedby={tooltipId}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        i
      </button>
      {shown
        ? createPortal(
            <div ref={bubbleRef} className="drawing-settings-tooltip-bubble" aria-hidden="true">
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
