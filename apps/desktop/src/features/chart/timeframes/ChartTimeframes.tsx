import { useEffect, useRef, useState } from 'react';
import { timeframeOptions } from '../../../shared/bridge/timeframes';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { useBridgeActions, useBridgeChartState, useBridgeConnection } from '../../bridge/BridgeSessionProvider';
import { TimeframeMenu } from './menu/TimeframeMenu';
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

export function ChartTimeframes() {
  const { symbol, timeframe, symbolLoading } = useBridgeChartState();
  const { status } = useBridgeConnection();
  const { requestHistory } = useBridgeActions();
  const { favorites, toggleFavorite } = useTimeframeFavorites();
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

  if (supported.length === 0) {
    // supportedTimeframes arrives with the handshake. Reserve the exact rows the
    // buttons will occupy (they wrap with the viewport width) using the same
    // buttons and styles, so no breakpoint-specific height can drift.
    return (
      <div className="timeframe-tabs placeholder" aria-hidden="true">
        <div className="timeframe-favorites">
          {timeframeOptions
            .filter((option) => favorites.includes(option.wire))
            .map((option) => (
              <button key={option.wire} disabled tabIndex={-1}>
                {option.label}
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
  // The active timeframe is always visible, even when it is not a favorite.
  const shown = supportedOptions.filter((option) => favorites.includes(option.wire) || option.wire === timeframe);
  const select = (wire: string) => {
    closeMenu(false);
    void requestHistory(wire);
  };

  return (
    <div className="timeframe-tabs">
      <div className="timeframe-favorites" role="group" aria-label="Chart timeframe">
        {shown.map((option) => {
          const isActive = timeframe === option.wire;
          return (
            <button
              key={option.wire}
              className={isActive ? 'active' : ''}
              disabled={disabled}
              aria-pressed={isActive}
              onClick={() => void requestHistory(option.wire)}
            >
              {option.label}
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
            options={supportedOptions}
            active={timeframe}
            favorites={favorites}
            disabled={disabled}
            onSelect={select}
            onToggleFavorite={toggleFavorite}
          />
        )}
      </div>
    </div>
  );
}
