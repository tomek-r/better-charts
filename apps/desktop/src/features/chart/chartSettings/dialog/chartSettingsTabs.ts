import type { ComponentType } from 'react';
import { CanvasIcon } from '../../../../shared/ui/icons/CanvasIcon';
import { ScalesIcon } from '../../../../shared/ui/icons/ScalesIcon';
import { StatusLineIcon } from '../../../../shared/ui/icons/StatusLineIcon';
import { CandlesIcon } from '../../../object-tree/CandlesIcon';
import { CanvasSettingsPanel } from './CanvasSettingsPanel';
import type { ChartSettingsPanelProps } from './chartSettingsPanelProps';
import { ScalesSettingsPanel } from './ScalesSettingsPanel';
import { StatusLineSettingsPanel } from './StatusLineSettingsPanel';
import { SymbolSettingsPanel } from './SymbolSettingsPanel';

/** One tab of the dialog's left column: its title, the icon beside it, and the panel it opens. */
interface ChartSettingsTab {
  readonly id: string;
  readonly title: string;
  readonly Icon: ComponentType;
  readonly Panel: ComponentType<ChartSettingsPanelProps>;
}

/** The dialog's tabs, in order; it opens on the first. A new tab is one entry here. */
export const CHART_SETTINGS_TABS: readonly ChartSettingsTab[] = [
  { id: 'symbol', title: 'Symbol', Icon: CandlesIcon, Panel: SymbolSettingsPanel },
  { id: 'statusLine', title: 'Status line', Icon: StatusLineIcon, Panel: StatusLineSettingsPanel },
  { id: 'scales', title: 'Scales and lines', Icon: ScalesIcon, Panel: ScalesSettingsPanel },
  { id: 'canvas', title: 'Canvas', Icon: CanvasIcon, Panel: CanvasSettingsPanel },
];
