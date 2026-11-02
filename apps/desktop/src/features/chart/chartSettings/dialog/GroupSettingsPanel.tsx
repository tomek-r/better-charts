import type { ChartSettingValue, SettingsSectionFields } from '../settingFields';
import { SettingsSection } from './SettingsSection';

interface GroupSettingsPanelProps {
  readonly sections: readonly SettingsSectionFields[];
  readonly values: Readonly<Record<string, ChartSettingValue>>;
  readonly onChange: (key: string, value: ChartSettingValue) => void;
}

/** A tab that edits one group of settings: every section the group declares, in its own order. */
export function GroupSettingsPanel({ sections, values, onChange }: GroupSettingsPanelProps) {
  return (
    <>
      {sections.map((section) => (
        <SettingsSection key={section.title} section={section} values={values} onChange={onChange} />
      ))}
    </>
  );
}
