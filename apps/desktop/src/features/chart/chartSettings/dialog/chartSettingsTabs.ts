import type { ComponentType } from 'react';
import { CandlesIcon } from '../../../object-tree/CandlesIcon';
import { SymbolSettingsPanel, type ChartSettingsPanelProps } from './SymbolSettingsPanel';

/** One tab of the dialog's left column: its title, the icon beside it, and the panel it opens. */
export interface ChartSettingsTab {
  readonly id: string;
  readonly title: string;
  readonly Icon: ComponentType;
  readonly Panel: ComponentType<ChartSettingsPanelProps>;
}

/** The dialog's tabs, in order; it opens on the first. A new tab is one entry here. */
export const CHART_SETTINGS_TABS: readonly ChartSettingsTab[] = [
  { id: 'symbol', title: 'Symbol', Icon: CandlesIcon, Panel: SymbolSettingsPanel },
];
