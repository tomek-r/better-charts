import { useEffect, useRef, useState } from 'react';
import type { DrawingTool } from './toolTypes';
import { DrawingToolIcon } from './DrawingToolIcon';

/**
 * The pointer group: the rail's first entry and the only grouped one. Its
 * button shows whichever tool of the group is armed (the arrow pointer while
 * no tool is active), and its menu lists exactly these two rows.
 */
const POINTER_TOOLS: ReadonlyArray<{ tool: DrawingTool; label: string }> = [
  { tool: null, label: 'Arrow pointer' },
  { tool: 'crosshair', label: 'Crosshair pointer' },
];

/**
 * Compact tool rail: pointer tools (arrow / crosshair) grouped behind the first
 * entry, then the fixed-range volume profile as a direct button.
 *
 * The group's icon and the arrow tab beside it both open the group's menu, and
 * the chevron points at that menu while it is closed and back at the rail while
 * it is open. Picking a row arms that tool. Escape closes the menu — and only
 * the menu — returning focus to the group's icon and taking the chevron away
 * with it; a click outside closes it too. The tab is revealed by the pointer,
 * so it reappears on the next hover.
 */
export function DrawingToolRail({
  drawingTool,
  onPick,
}: {
  drawingTool: DrawingTool;
  onPick: (tool: DrawingTool) => void;
}) {
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  /**
   * Whether the arrow tab is showing. The pointer reveals it and takes it away
   * again on leave; Escape clears it explicitly, because the pointer is usually
   * still resting on the tab it just clicked and CSS :hover would keep the
   * chevron on screen after the menu it belongs to is gone.
   */
  const [revealed, setRevealed] = useState(false);
  const railRef = useRef<HTMLElement>(null);
  /** The group's icon button: Escape hands focus back to it. */
  const headRef = useRef<HTMLButtonElement | null>(null);
  // The row the group's button represents: the armed pointer tool, else the
  // group's primary (arrow pointer) — so the icon always names what it is while
  // the group owns the active tool, and what it would arm when it does not.
  const armed = POINTER_TOOLS.find((row) => row.tool === drawingTool);
  const head = armed ?? POINTER_TOOLS[0];
  const pick = (tool: DrawingTool) => {
    setFlyoutOpen(false);
    onPick(tool);
  };
  const toggleFlyout = () => {
    setFlyoutOpen((open) => !open);
  };
  useEffect(() => {
    if (!flyoutOpen) {
      return;
    }
    const onPointerDownOutside = (event: MouseEvent) => {
      if (!railRef.current?.contains(event.target as Node)) {
        setFlyoutOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // The menu owns this Escape: stopping propagation keeps the chart's own
      // Escape (disarm the active tool / unstage a draft) from firing as well.
      event.stopPropagation();
      setFlyoutOpen(false);
      setRevealed(false);
      headRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('keydown', onKeyDown);
    // Move focus into the menu: the checked row, else the first one.
    const checked = railRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    const first = railRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    (checked ?? first)?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [flyoutOpen]);
  return (
    <nav className="tool-rail" aria-label="Drawing tools" ref={railRef}>
      <div className="tool-rail-group">
        <div
          className={`tool-rail-split${revealed || flyoutOpen ? ' open' : ''}`}
          onPointerEnter={() => setRevealed(true)}
          onPointerLeave={() => setRevealed(false)}
        >
          <button
            type="button"
            className={`tool-rail-btn${armed ? ' active' : ''}`}
            aria-label="Pointer tools"
            title={head.label}
            aria-haspopup="menu"
            aria-expanded={flyoutOpen}
            ref={headRef}
            onClick={toggleFlyout}
          >
            <DrawingToolIcon name={head.tool ?? 'cursor'} size={22} />
          </button>
          <button
            type="button"
            className="tool-rail-arrow"
            aria-haspopup="menu"
            aria-expanded={flyoutOpen}
            aria-label="Open pointer tools"
            onClick={toggleFlyout}
          >
            <svg
              className="tool-rail-arrow-glyph"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {/* Closed: points at the menu it opens. Open: points back at the rail. */}
              <path d={flyoutOpen ? 'M8.5 3.5 5 7l3.5 3.5' : 'M5.5 3.5 9 7l-3.5 3.5'} />
            </svg>
          </button>
        </div>
        {flyoutOpen && (
          <div className="tool-flyout" role="menu" aria-label="Pointer tools">
            {POINTER_TOOLS.map((row) => (
              <button
                key={row.label}
                type="button"
                role="menuitemradio"
                aria-checked={drawingTool === row.tool}
                className={`tool-flyout-row${drawingTool === row.tool ? ' selected' : ''}`}
                onClick={() => pick(row.tool)}
              >
                <DrawingToolIcon name={row.tool ?? 'cursor'} size={18} />
                <span className="tool-flyout-label">{row.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="tool-rail-sep" aria-hidden="true" />
      <button
        type="button"
        className={`tool-rail-btn${drawingTool === 'fixedRangeProfile' ? ' active' : ''}`}
        aria-label="Fixed range volume profile"
        title="Fixed range volume profile"
        aria-pressed={drawingTool === 'fixedRangeProfile'}
        onClick={() => pick('fixedRangeProfile')}
      >
        <DrawingToolIcon name="fixedRangeProfile" size={26} />
      </button>
    </nav>
  );
}
