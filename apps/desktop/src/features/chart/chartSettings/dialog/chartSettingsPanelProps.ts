import type { ChartSettings } from '../chartSettings';

/** What every tab's panel edits: the draft settings of the dialog, and the way to replace them. */
export interface ChartSettingsPanelProps {
  readonly settings: ChartSettings;
  readonly onChange: (settings: ChartSettings) => void;
}
