import { Fragment } from 'react';
import type { SettingValue, SettingValues } from '../../../chart/engine/settings/settingInputs';
import { settingStyleKey, type SettingStyleDefinition } from '../../../chart/engine/settings/settingStyles';
import { SettingStyleField } from './SettingStyleField';

interface StyleTabProps {
  readonly definitions: readonly SettingStyleDefinition[];
  readonly values: SettingValues;
  readonly onChange: (key: string, value: SettingValue) => void;
}

/**
 * A child follows its parent's checkbox. A parent without one (a number, a choice, a plain colour)
 * switches nothing off, and so does a parent id no definition declares.
 */
function isParentVisible(
  definitions: readonly SettingStyleDefinition[],
  { parentId }: SettingStyleDefinition,
  values: SettingValues,
): boolean {
  const parent = definitions.find((definition) => definition.id === parentId);
  if (parent === undefined) {
    return true;
  }
  const parentVisible = values[settingStyleKey(parent.id, 'visible')];
  return parentVisible === undefined || parentVisible === true;
}

/**
 * The Style tab: one row per style, in declaration order, children indented under their parent. A style
 * carrying a `section` prints its caption first, and the styles after it read as that group.
 */
export function StyleTab({ definitions, values, onChange }: StyleTabProps) {
  return (
    <div className="drawing-settings-style-list">
      {definitions.map((definition) => (
        <Fragment key={definition.id}>
          {definition.section === undefined ? null : (
            <h3 className="drawing-settings-style-section">{definition.section}</h3>
          )}
          <SettingStyleField
            definition={definition}
            values={values}
            onChange={onChange}
            disabled={!isParentVisible(definitions, definition, values)}
          />
        </Fragment>
      ))}
    </div>
  );
}
