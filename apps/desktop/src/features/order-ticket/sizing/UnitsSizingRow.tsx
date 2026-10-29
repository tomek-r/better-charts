import type { Dispatch, RefObject, SetStateAction } from 'react';
import { MAX_RISK_PERCENT } from './riskBasis';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import type { BrokerSymbol } from '../../../shared/bridge/types';
import { unitsStepAttributes } from './defaultVolume';
import { SizingModeMenu } from './SizingModeMenu';
import type { RiskUnitsMode, UnitsMode } from './unitsMode';
import { UNITS_MODE_COPY, sizingModeMenuItems } from './unitsModeCopy';
import { useSizingModeMenu } from './useSizingModeMenu';

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
  currency,
  unitsAutoMode,
  instrument,
}: {
  instrument: BrokerSymbol | undefined;
  unitsMode: UnitsMode;
  orderVolume: string;
  riskAmount: string;
  setOrderVolume: Dispatch<SetStateAction<string>>;
  setVolumeManual: Dispatch<SetStateAction<boolean>>;
  setRiskAmount: (value: string) => void;
  applyUnitsMode: (mode: UnitsMode) => void;
  currency: string | undefined;
  unitsAutoMode: RefObject<RiskUnitsMode>;
}) {
  const { open, menuRef, labelTriggerRef, indicatorTriggerRef, toggleFrom, close } = useSizingModeMenu();
  const { rowLabel, placeholder, inputLabel, menuLabel } = UNITS_MODE_COPY[unitsMode];
  // Compact in-field mode indicator (TV behavior: same menu from the right side).
  const sizingIndicator = menuLabel(currency);
  return (
    <div className="ticket-row units-row">
      <button
        type="button"
        className="ticket-row-label ticket-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={labelTriggerRef}
        onClick={() => toggleFrom('label')}
      >
        {rowLabel} <CaretIcon className="ticket-caret" />
      </button>
      <div className="ticket-field">
        <input
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="ticket-value"
          type="number"
          inputMode="decimal"
          min={unitsMode === 'equity' ? 0 : undefined}
          max={unitsMode === 'equity' ? MAX_RISK_PERCENT : undefined}
          step="any"
          {...(unitsMode === 'units' ? unitsStepAttributes(instrument) : {})}
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
          aria-expanded={open}
          ref={indicatorTriggerRef}
          onClick={() => toggleFrom('indicator')}
          aria-label="Sizing mode"
        >
          {sizingIndicator} <CaretIcon className="ticket-caret" />
        </button>
      </div>
      {open && (
        <SizingModeMenu
          menuRef={menuRef}
          items={sizingModeMenuItems(currency)}
          unitsMode={unitsMode}
          onSelect={(mode) => {
            applyUnitsMode(mode);
            close();
          }}
        />
      )}
    </div>
  );
}
