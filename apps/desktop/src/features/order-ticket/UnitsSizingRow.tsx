import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef, useState } from 'react';
import type { AccountSnapshot } from '../../shared/bridge/types';
import { CaretIcon } from '../../shared/ui/CaretIcon';

/** The order ticket's Units sizing row: manual volume/risk field, swap button,
 * in-field sizing indicator and the sizing-mode menu (units / money / equity). */
export function UnitsSizingRow({
  unitsMode,
  orderVolume,
  riskAmount,
  setOrderVolume,
  setVolumeManual,
  setRiskAmount,
  applyUnitsMode,
  account,
  unitsAutoMode,
}: {
  unitsMode: 'money' | 'equity' | 'units';
  orderVolume: string;
  riskAmount: string;
  setOrderVolume: Dispatch<SetStateAction<string>>;
  setVolumeManual: Dispatch<SetStateAction<boolean>>;
  setRiskAmount: (value: string) => void;
  applyUnitsMode: (mode: 'money' | 'equity' | 'units') => void;
  account: AccountSnapshot | undefined;
  unitsAutoMode: MutableRefObject<'money' | 'equity'>;
}) {
  // TV-style sizing-mode menu for the ONE Units input: opens from the row label
  // or the in-field indicator, closes on select / outside press / Escape, and is
  // fully keyboard operable (buttons + menu/menuitemradio roles + arrow keys).
  // UI-local state (document listeners + focus restore) with no execution/data
  // interaction, so it lives in the row instead of the app root.
  const [unitsMenuOpen, setUnitsMenuOpen] = useState(false);
  const unitsMenuRef = useRef<HTMLDivElement>(null);
  const labelTriggerRef = useRef<HTMLButtonElement>(null);
  const indicatorTriggerRef = useRef<HTMLButtonElement>(null);
  const unitsTriggerRef = useRef<'label' | 'indicator'>('label');
  const closeUnitsMenu = () => {
    setUnitsMenuOpen(false);
    (unitsTriggerRef.current === 'indicator' ? indicatorTriggerRef.current : labelTriggerRef.current)?.focus();
  };
  useEffect(() => {
    if (!unitsMenuOpen) {
      return;
    }
    const onPointerDownOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        unitsMenuRef.current?.contains(target) ||
        labelTriggerRef.current?.contains(target) ||
        indicatorTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setUnitsMenuOpen(false);
    };
    const onKeyDownOutside = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeUnitsMenu();
      }
    };
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('keydown', onKeyDownOutside);
    // Move focus into the menu: the checked item, else the first enabled one.
    const checked =
      unitsMenuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ??
      unitsMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not(:disabled)');
    checked?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointerDownOutside);
      document.removeEventListener('keydown', onKeyDownOutside);
    };
  }, [unitsMenuOpen]);
  // Compact in-field mode indicator (TV behavior: same menu from the right side).
  let sizingIndicator = 'Risk, % equity';
  if (unitsMode === 'units') {
    sizingIndicator = 'Units';
  } else if (unitsMode === 'money') {
    sizingIndicator = `Risk, ${account?.currency ?? 'CCY'}`;
  }
  let placeholder = 'Amount';
  let inputLabel = 'Risk amount';
  const rowLabel = unitsMode === 'units' ? 'Units' : 'Risk';
  if (unitsMode === 'units') {
    placeholder = 'Lots';
    inputLabel = 'Units';
  } else if (unitsMode === 'equity') {
    placeholder = 'Percent';
    inputLabel = 'Risk percent';
  }
  return (
    <div className="ticket-row units-row">
      <button
        type="button"
        className="ticket-row-label ticket-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={unitsMenuOpen}
        ref={labelTriggerRef}
        onClick={() => {
          unitsTriggerRef.current = 'label';
          setUnitsMenuOpen((open) => !open);
        }}
      >
        {rowLabel} <CaretIcon />
      </button>
      <div className="ticket-field">
        <input
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="ticket-value"
          inputMode="decimal"
          value={unitsMode === 'units' ? orderVolume : riskAmount}
          onChange={(event) => {
            const value = event.target.value;
            if (unitsMode === 'units') {
              setOrderVolume(value);
              setVolumeManual(value.trim() !== '');
            } else {
              setRiskAmount(value);
            }
          }}
          placeholder={placeholder}
          aria-label={inputLabel}
        />
        <button
          className="ticket-swap"
          onClick={() => applyUnitsMode(unitsMode === 'units' ? unitsAutoMode.current : 'units')}
          aria-label={unitsMode === 'units' ? 'Switch to automatic sizing' : 'Enter units manually'}
          title={unitsMode === 'units' ? 'Switch to automatic sizing' : 'Enter units manually'}
        >
          ⇄
        </button>
        <button
          type="button"
          className="ticket-mode-indicator"
          aria-haspopup="menu"
          aria-expanded={unitsMenuOpen}
          ref={indicatorTriggerRef}
          onClick={() => {
            unitsTriggerRef.current = 'indicator';
            setUnitsMenuOpen((open) => !open);
          }}
          aria-label="Sizing mode"
        >
          {sizingIndicator} <CaretIcon />
        </button>
      </div>
      {unitsMenuOpen && (
        <div
          className="ticket-menu"
          role="menu"
          aria-label="Sizing mode"
          ref={unitsMenuRef}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
              return;
            }
            event.preventDefault();
            const items = Array.from(
              unitsMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? [],
            );
            const index = items.indexOf(document.activeElement as HTMLElement);
            let next = index - 1;
            if (event.key === 'ArrowDown') {
              next = (index + 1) % items.length;
            } else if (index <= 0) {
              next = items.length - 1;
            }
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={unitsMode === 'units'}
            className={`ticket-menu-item${unitsMode === 'units' ? ' selected' : ''}`}
            onClick={() => {
              applyUnitsMode('units');
              closeUnitsMenu();
            }}
          >
            <span>Units</span>
            <span
              className="ticket-menu-info"
              title="Manually set volume in lots"
              aria-label="About Units sizing"
              onClick={(event) => event.stopPropagation()}
            >
              i
            </span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={unitsMode === 'money'}
            className={`ticket-menu-item${unitsMode === 'money' ? ' selected' : ''}`}
            onClick={() => {
              applyUnitsMode('money');
              closeUnitsMenu();
            }}
          >
            <span>Risk, {account?.currency ?? 'CCY'}</span>
            <span
              className="ticket-menu-info"
              title="Volume sized from the risk amount and SL distance"
              aria-label="About Risk sizing"
              onClick={(event) => event.stopPropagation()}
            >
              i
            </span>
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={unitsMode === 'equity'}
            className={`ticket-menu-item${unitsMode === 'equity' ? ' selected' : ''}`}
            onClick={() => {
              applyUnitsMode('equity');
              closeUnitsMenu();
            }}
          >
            <span>Risk, % equity</span>
            <span
              className="ticket-menu-info"
              title="Volume sized from a percentage of account equity"
              aria-label="About percent-of-equity sizing"
              onClick={(event) => event.stopPropagation()}
            >
              i
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
