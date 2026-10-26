import type { ReactNode } from 'react';
import type { ToolInputValue, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import type { ToolSettingsSchema } from '../../chart/engine/drawings/toolSettings';
import { InputsTab } from './InputsTab';
import { StyleTab } from './StyleTab';

/** What every tab's content is given: the merged draft values and the one way to edit them. */
export interface SettingsPanelProps {
  readonly values: ToolInputValues;
  readonly onChange: (key: string, value: ToolInputValue) => void;
}

/** One tab of the dialog; a later tab (Coordinates, Visibility) is one more entry in `buildSettingsTabs`. */
export interface SettingsTab {
  readonly id: string;
  readonly title: string;
  readonly render: (panel: SettingsPanelProps) => ReactNode;
}

/** The tabs a tool's declaration earns, in tab order: a tab with nothing to show is not built. */
export function buildSettingsTabs({ inputs = [], styles = [] }: ToolSettingsSchema): SettingsTab[] {
  const tabs: SettingsTab[] = [];
  if (inputs.length > 0) {
    tabs.push({
      id: 'inputs',
      title: 'Inputs',
      render: (panel) => <InputsTab definitions={inputs} {...panel} />,
    });
  }
  if (styles.length > 0) {
    tabs.push({
      id: 'style',
      title: 'Style',
      render: (panel) => <StyleTab definitions={styles} {...panel} />,
    });
  }
  return tabs;
}
