import { CANVAS_SETTINGS } from '../canvasSettings';
import { withCanvasValue } from '../chartSettings';
import type { ChartSettingValue } from '../settingFields';
import type { ChartSettingsPanelProps } from './chartSettingsPanelProps';
import { SettingsSection } from './SettingsSection';

/** The Canvas tab: the colours, grid lines, text and margins the chart's canvas is drawn with. */
export function CanvasSettingsPanel({ settings, onChange }: ChartSettingsPanelProps) {
  const setValue = (key: string, value: ChartSettingValue) => onChange(withCanvasValue(settings, key, value));
  return (
    <>
      {CANVAS_SETTINGS.map((section) => (
        <SettingsSection key={section.title} section={section} values={settings.canvas} onChange={setValue} />
      ))}
    </>
  );
}
