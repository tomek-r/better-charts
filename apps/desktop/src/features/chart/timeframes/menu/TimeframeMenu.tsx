import { useLayoutEffect, useRef, useState } from 'react';
import {
  timeframeLabel,
  timeframeLongLabel,
  timeframeSection,
  type TimeframeSection,
} from '../../../../shared/bridge/timeframes';
import { CaretIcon } from '../../../../shared/ui/icons/CaretIcon';
import { StarIcon } from '../../../../shared/ui/icons/StarIcon';

const sectionTitles: { section: TimeframeSection; title: string }[] = [
  { section: 'minutes', title: 'Minutes' },
  { section: 'hours', title: 'Hours' },
  { section: 'days', title: 'Days & above' },
];

/**
 * Keeps the absolutely positioned menu inside the viewport without moving the chart, and pinned to
 * the spot where it opened: starring a timeframe reflows the header (the chevron it hangs from
 * moves), but the menu must not slide under the user's cursor while open.
 */
function useViewportFit() {
  const menuRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef<{ left: number; top: number } | null>(null);
  // No deps: any render may have shifted the anchor, so re-measure the natural position each time.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    menu.style.transform = '';
    const rect = menu.getBoundingClientRect();
    if (!openedAt.current) {
      const margin = 8;
      menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.top - margin)}px`;
      const overflow = Math.max(0, rect.right - (window.innerWidth - margin));
      openedAt.current = { left: rect.left - overflow, top: rect.top };
    }
    const dx = openedAt.current.left - rect.left;
    const dy = openedAt.current.top - rect.top;
    if (dx !== 0 || dy !== 0) {
      menu.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  });
  return menuRef;
}

export function TimeframeMenu({
  options,
  active,
  favorites,
  disabled,
  onSelect,
  onToggleFavorite,
}: {
  options: { wire: string }[];
  active: string | undefined;
  favorites: readonly string[];
  disabled: boolean;
  onSelect: (wire: string) => void;
  onToggleFavorite: (wire: string) => void;
}) {
  const menuRef = useViewportFit();
  const [collapsed, setCollapsed] = useState<ReadonlySet<TimeframeSection>>(new Set());
  const toggleSection = (section: TimeframeSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(section)) {
        next.add(section);
      }
      return next;
    });

  return (
    <div className="timeframe-menu" role="dialog" aria-label="Timeframes" ref={menuRef}>
      {sectionTitles.map(({ section, title }) => {
        const rows = options.filter((option) => timeframeSection(option.wire) === section);
        if (rows.length === 0) {
          return null;
        }
        const isCollapsed = collapsed.has(section);
        return (
          <div key={section} className="timeframe-menu-section">
            <button
              className="timeframe-menu-heading"
              aria-expanded={!isCollapsed}
              onClick={() => toggleSection(section)}
            >
              {title}
              <CaretIcon className={isCollapsed ? 'timeframe-caret collapsed' : 'timeframe-caret'} />
            </button>
            {!isCollapsed &&
              rows.map(({ wire }) => {
                const isFavorite = favorites.includes(wire);
                const short = timeframeLabel(wire);
                return (
                  <div key={wire} className={wire === active ? 'timeframe-menu-row active' : 'timeframe-menu-row'}>
                    <button
                      className="popup-menu-row timeframe-menu-select"
                      disabled={disabled}
                      aria-current={wire === active ? 'true' : undefined}
                      onClick={() => onSelect(wire)}
                    >
                      {timeframeLongLabel(wire)}
                    </button>
                    <button
                      className={isFavorite ? 'timeframe-menu-star favorite' : 'timeframe-menu-star'}
                      aria-pressed={isFavorite}
                      aria-label={`${isFavorite ? 'Remove' : 'Add'} ${short} ${isFavorite ? 'from' : 'to'} favorites`}
                      onClick={() => onToggleFavorite(wire)}
                    >
                      <StarIcon filled={isFavorite} />
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
