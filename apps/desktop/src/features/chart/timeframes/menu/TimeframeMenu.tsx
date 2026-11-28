import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { INTERVAL_NOT_SERVED_MESSAGE, parseIntervalInput } from '../../../../shared/bridge/chartIntervalModel';
import {
  intervalLabel,
  intervalLongLabel,
  intervalSection,
  type IntervalSection,
} from '../../../../shared/bridge/chartIntervals';
import { CaretIcon } from '../../../../shared/ui/icons/CaretIcon';
import { StarIcon } from '../../../../shared/ui/icons/StarIcon';

// TradingView lists its tick intervals first, so the section order is the same here.
const sectionTitles: { section: IntervalSection; title: string }[] = [
  { section: 'ticks', title: 'Ticks' },
  { section: 'seconds', title: 'Seconds' },
  { section: 'minutes', title: 'Minutes' },
  { section: 'hours', title: 'Hours' },
  { section: 'days', title: 'Days & above' },
];

/** The message the interval input points at while its text names no interval. */
const INTERVAL_ERROR_ID = 'timeframe-menu-interval-error';

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

interface CustomIntervalInputProps {
  canDraw: (wire: string) => boolean;
  disabled: boolean;
  onAddInterval: (wire: string) => void;
}

/** The interval input: Enter adds the interval it names, and a text naming none explains itself below. */
function CustomIntervalInput({ canDraw, disabled, onAddInterval }: CustomIntervalInputProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const editText = (typed: string) => {
    setText(typed);
    setError(undefined);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseIntervalInput(text);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (!canDraw(parsed.interval.code)) {
      setError(INTERVAL_NOT_SERVED_MESSAGE);
      return;
    }
    editText('');
    onAddInterval(parsed.interval.code);
  };
  return (
    <form onSubmit={submit}>
      <input
        className="timeframe-menu-input"
        type="text"
        aria-label="Custom interval"
        placeholder="37T, 5s, 7m, 4M"
        autoComplete="off"
        spellCheck={false}
        value={text}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : INTERVAL_ERROR_ID}
        onChange={(event) => editText(event.target.value)}
      />
      {error !== undefined && (
        <p id={INTERVAL_ERROR_ID} className="error-text timeframe-menu-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

interface TimeframeMenuRowProps {
  wire: string;
  active: string | undefined;
  favorites: readonly string[];
  customIntervals: readonly string[];
  disabled: boolean;
  onSelect: (wire: string) => void;
  onToggleFavorite: (wire: string) => void;
  onRemoveCustomInterval: (wire: string) => void;
}

/** One interval: its label, its star, and for an interval the user typed the button that removes it. */
function TimeframeMenuRow({
  wire,
  active,
  favorites,
  customIntervals,
  disabled,
  onSelect,
  onToggleFavorite,
  onRemoveCustomInterval,
}: TimeframeMenuRowProps) {
  const isFavorite = favorites.includes(wire);
  const shortLabel = intervalLabel(wire);
  return (
    <div className={wire === active ? 'timeframe-menu-row active' : 'timeframe-menu-row'}>
      <button
        className="popup-menu-row timeframe-menu-select"
        disabled={disabled}
        aria-current={wire === active ? 'true' : undefined}
        onClick={() => onSelect(wire)}
      >
        {intervalLongLabel(wire)}
      </button>
      {customIntervals.includes(wire) && (
        <button
          className="timeframe-menu-remove"
          aria-label={`Remove ${shortLabel} from the menu`}
          onClick={() => onRemoveCustomInterval(wire)}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <button
        className={isFavorite ? 'timeframe-menu-star favorite' : 'timeframe-menu-star'}
        aria-pressed={isFavorite}
        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${shortLabel} ${isFavorite ? 'from' : 'to'} favorites`}
        onClick={() => onToggleFavorite(wire)}
      >
        <StarIcon filled={isFavorite} />
      </button>
    </div>
  );
}

interface TimeframeMenuProps {
  options: { wire: string }[];
  active: string | undefined;
  favorites: readonly string[];
  customIntervals: readonly string[];
  canDraw: (wire: string) => boolean;
  disabled: boolean;
  onSelect: (wire: string) => void;
  onAddInterval: (wire: string) => void;
  onToggleFavorite: (wire: string) => void;
  onRemoveCustomInterval: (wire: string) => void;
}

export function TimeframeMenu({
  options,
  active,
  favorites,
  customIntervals,
  canDraw,
  disabled,
  onSelect,
  onAddInterval,
  onToggleFavorite,
  onRemoveCustomInterval,
}: TimeframeMenuProps) {
  const menuRef = useViewportFit();
  const [collapsed, setCollapsed] = useState<ReadonlySet<IntervalSection>>(new Set());
  const toggleSection = (section: IntervalSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(section)) {
        next.add(section);
      }
      return next;
    });

  return (
    <div className="timeframe-menu" role="dialog" aria-label="Timeframes" ref={menuRef}>
      <CustomIntervalInput canDraw={canDraw} disabled={disabled} onAddInterval={onAddInterval} />
      {sectionTitles.map(({ section, title }) => {
        const rows = options.filter((option) => intervalSection(option.wire) === section);
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
              rows.map(({ wire }) => (
                <TimeframeMenuRow
                  key={wire}
                  wire={wire}
                  active={active}
                  favorites={favorites}
                  customIntervals={customIntervals}
                  disabled={disabled}
                  onSelect={onSelect}
                  onToggleFavorite={onToggleFavorite}
                  onRemoveCustomInterval={onRemoveCustomInterval}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
