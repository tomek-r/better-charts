import type { ReactNode } from 'react';
import type { ChartDrawingPointRule } from '../../chart/engine/drawings/toolDrawings';
import type { ToolInputValue, ToolInputValues } from '../../chart/engine/drawings/toolInputs';
import type { ToolSettingsSchema } from '../../chart/engine/drawings/toolSettings';
import { CoordinatesTab, type CoordinateEditing } from './CoordinatesTab';
import { InputsTab } from './InputsTab';
import { StyleTab } from './StyleTab';
import { VisibilityTab, type TimeframeVisibilityEditing } from './VisibilityTab';

/** The id of the Coordinates tab, which the dialog opens when the tool refuses the saved anchors. */
export const COORDINATES_TAB_ID = 'coordinates';

const VISIBILITY_TAB_ID = 'visibility';

/** What a tool declares for its dialog: its settings and the anchors each drawing holds. */
export interface DrawingSettingsSchema extends ToolSettingsSchema {
  readonly points?: ChartDrawingPointRule;
}

/** What every tab's content is given: the merged draft values, the anchors, and the ways to edit them. */
export interface SettingsPanelProps {
  readonly values: ToolInputValues;
  readonly onChange: (key: string, value: ToolInputValue) => void;
  readonly coordinates: CoordinateEditing;
  readonly timeframeVisibility: TimeframeVisibilityEditing;
}

/** One tab of the dialog; another tab is one more entry in `buildSettingsTabs`. */
export interface SettingsTab {
  readonly id: string;
  readonly title: string;
  readonly render: (panel: SettingsPanelProps) => ReactNode;
}

/** The tabs a tool's declaration earns, in tab order: a tab with nothing to show is not built. */
export function buildSettingsTabs({ inputs = [], styles = [], points }: DrawingSettingsSchema): SettingsTab[] {
  const tabs: SettingsTab[] = [];
  if (inputs.length > 0) {
    tabs.push({
      id: 'inputs',
      title: 'Inputs',
      render: ({ values, onChange }) => <InputsTab definitions={inputs} values={values} onChange={onChange} />,
    });
  }
  if (styles.length > 0) {
    tabs.push({
      id: 'style',
      title: 'Style',
      render: ({ values, onChange }) => <StyleTab definitions={styles} values={values} onChange={onChange} />,
    });
  }
  if (points !== undefined) {
    tabs.push({
      id: COORDINATES_TAB_ID,
      title: 'Coordinates',
      render: ({ coordinates }) => <CoordinatesTab anchor={points.anchor} {...coordinates} />,
    });
    // A tool that anchors drawings places them, and every placed drawing can be hidden per timeframe.
    tabs.push({
      id: VISIBILITY_TAB_ID,
      title: 'Visibility',
      render: ({ timeframeVisibility }) => <VisibilityTab {...timeframeVisibility} />,
    });
  }
  return tabs;
}
