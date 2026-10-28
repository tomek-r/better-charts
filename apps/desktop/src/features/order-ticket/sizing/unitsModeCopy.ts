import type { UnitsMode } from './unitsMode';

type UnitsModeCopy = {
  rowLabel: string;
  placeholder: string;
  inputLabel: string;
  menuLabel: (currency: string | undefined) => string;
  infoTitle: string;
  infoAria: string;
};

/** Shown when risk sizing is selected while the stop loss is off. */
export const SIZING_NEEDS_STOP_MESSAGE =
  'Money/% sizing needs a stop distance — enable Stop loss or switch to Units mode.';

export const UNITS_MODE_COPY: Record<UnitsMode, UnitsModeCopy> = {
  units: {
    rowLabel: 'Units',
    placeholder: 'Lots',
    inputLabel: 'Units',
    menuLabel: () => 'Units',
    infoTitle: 'Manually set volume in lots',
    infoAria: 'About Units sizing',
  },
  money: {
    rowLabel: 'Risk',
    placeholder: 'Amount',
    inputLabel: 'Risk amount',
    menuLabel: (currency) => `Risk, ${currency ?? 'CCY'}`,
    infoTitle: 'Volume sized from the risk amount and SL distance',
    infoAria: 'About Risk sizing',
  },
  equity: {
    rowLabel: 'Risk',
    placeholder: 'Percent',
    inputLabel: 'Risk percent',
    menuLabel: () => 'Risk, % equity',
    infoTitle: 'Volume sized from a percentage of account equity',
    infoAria: 'About percent-of-equity sizing',
  },
};

/** Menu order; the in-field indicator shows the selected mode's menu label. */
const SIZING_MODES: readonly UnitsMode[] = ['units', 'money', 'equity'];

export type SizingModeMenuItem = { mode: UnitsMode; label: string; infoTitle: string; infoAria: string };

export function sizingModeMenuItems(currency: string | undefined): SizingModeMenuItem[] {
  return SIZING_MODES.map((mode) => ({
    mode,
    label: UNITS_MODE_COPY[mode].menuLabel(currency),
    infoTitle: UNITS_MODE_COPY[mode].infoTitle,
    infoAria: UNITS_MODE_COPY[mode].infoAria,
  }));
}
