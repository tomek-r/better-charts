import { useEffect, useRef, useState } from 'react';
import { timeframeOptions } from '../../../shared/bridge/timeframes';
import {
  TICK_INTERVALS,
  intervalLabel,
  intervalOrderKey,
  isTickBuiltInterval,
  isTickInterval,
  seriesTimeframeOf,
} from '../../../shared/bridge/chartIntervals';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { useBridgeActions } from '../../bridge/BridgeSessionProvider';
import { useBridgeChartState, useBridgeConnection } from '../../bridge/bridgeSelectors';
import { TimeframeMenu } from './menu/TimeframeMenu';
import { useCustomIntervals } from './useCustomIntervals';
import { useTimeframeFavorites } from './useTimeframeFavorites';

/** Closes on Escape (returning focus to the trigger) and on a pointer press outside `anchor`. */
function useDismiss(open: boolean, anchor: React.RefObject<HTMLElement | null>, close: (refocus: boolean) => void) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(true);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, anchor, close]);
}

/** The row's buttons share one width; a shown tick interval's longer label ('1000T') widens all of them. */
function favoritesRowClass(options: readonly { wire: string }[]): string {
  const showsTickInterval = options.some((option) => isTickInterval(option.wire));
  return showsTickInterval ? 'timeframe-favorites timeframe-favorites-tick' : 'timeframe-favorites';
}

export function ChartTimeframes() {
  const { symbol, timeframe, symbolLoading } = useBridgeChartState();
  const { status } = useBridgeConnection();
  const { requestInterval } = useBridgeActions();
  const { favorites, toggleFavorite } = useTimeframeFavorites();
  const { customIntervals, addCustomInterval, removeCustomInterval } = useCustomIntervals();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const closeMenu = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      chevronRef.current?.focus();
    }
  };
  useDismiss(open, anchorRef, closeMenu);

  const supported = status.supportedTimeframes ?? [];
  const disabled = !symbol || status.state !== 'connected' || symbolLoading;
  // The tick intervals are this app's own, so they are offered whatever the EA advertises, and first.
  const tickOptions = TICK_INTERVALS.map((interval) => ({ wire: interval.code }));

  if (supported.length === 0) {
    // supportedTimeframes arrives with the handshake. Reserve the exact rows the
    // buttons will occupy (they wrap with the viewport width) using the same
    // buttons and styles, so no breakpoint-specific height can drift.
    const reserved = [...tickOptions, ...timeframeOptions].filter((option) => favorites.includes(option.wire));
    return (
      <div className="timeframe-tabs placeholder" aria-hidden="true">
        <div className={favoritesRowClass(reserved)}>
          {reserved.map((option) => (
            <button key={option.wire} disabled tabIndex={-1}>
              {intervalLabel(option.wire)}
            </button>
          ))}
        </div>
        <button className="timeframe-chevron" disabled tabIndex={-1}>
          <CaretIcon className="timeframe-caret" />
        </button>
      </div>
    );
  }

  const supportedOptions = timeframeOptions.filter((option) => supported.includes(option.wire));
  // A typed interval is drawable whenever the chart can build it: a tick-built one always, and an
  // aggregated one only when the bridge advertises the timeframe it is grouped from.
  const canDraw = (wire: string) => isTickBuiltInterval(wire) || supported.includes(seriesTimeframeOf(wire));
  const customOptions = customIntervals.filter((wire) => canDraw(wire)).map((wire) => ({ wire }));
  const options = [...tickOptions, ...customOptions, ...supportedOptions].sort(
    (first, second) => intervalOrderKey(first.wire) - intervalOrderKey(second.wire),
  );
  // The active interval is always visible, even when it is not a favorite.
  const shown = options.filter((option) => favorites.includes(option.wire) || option.wire === timeframe);
  const select = (wire: string) => {
    closeMenu(false);
    void requestInterval(wire);
  };
  // A typed interval is remembered in the menu and drawn at once.
  const addInterval = (wire: string) => {
    addCustomInterval(wire);
    select(wire);
  };
  // Removing a typed interval unstars it too, so no header button is left without a menu row.
  const removeInterval = (wire: string) => {
    removeCustomInterval(wire);
    if (favorites.includes(wire)) {
      toggleFavorite(wire);
    }
  };

  return (
    <div className="timeframe-tabs">
      <div className={favoritesRowClass(shown)} role="group" aria-label="Chart timeframe">
        {shown.map((option) => {
          const isActive = timeframe === option.wire;
          return (
            <button
              key={option.wire}
              className={isActive ? 'active' : ''}
              disabled={disabled}
              aria-pressed={isActive}
              onClick={() => void requestInterval(option.wire)}
            >
              {intervalLabel(option.wire)}
            </button>
          );
        })}
      </div>
      <div className="timeframe-menu-anchor" ref={anchorRef}>
        <button
          ref={chevronRef}
          className="timeframe-chevron"
          aria-label="More timeframes"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <CaretIcon className="timeframe-caret" />
        </button>
        {open && (
          <TimeframeMenu
            options={options}
            active={timeframe}
            favorites={favorites}
            customIntervals={customIntervals}
            canDraw={canDraw}
            disabled={disabled}
            onSelect={select}
            onAddInterval={addInterval}
            onToggleFavorite={toggleFavorite}
            onRemoveCustomInterval={removeInterval}
          />
        )}
      </div>
    </div>
  );
}
