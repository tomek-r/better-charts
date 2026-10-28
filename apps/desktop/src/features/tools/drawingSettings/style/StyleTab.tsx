import type { ToolInputValue, ToolInputValues } from '../../../chart/engine/drawings/toolInputs';
import { toolStyleKey, type ToolStyleDefinition } from '../../../chart/engine/drawings/toolStyles';
import { ToolStyleField } from './ToolStyleField';

interface StyleTabProps {
  readonly definitions: readonly ToolStyleDefinition[];
  readonly values: ToolInputValues;
  readonly onChange: (key: string, value: ToolInputValue) => void;
}

/**
 * A child follows its parent's checkbox. A parent without one (a number, a choice, a plain colour)
 * switches nothing off, and so does a parent id no definition declares.
 */
function isParentVisible(
  definitions: readonly ToolStyleDefinition[],
  { parentId }: ToolStyleDefinition,
  values: ToolInputValues,
): boolean {
  const parent = definitions.find((definition) => definition.id === parentId);
  if (parent === undefined) {
    return true;
  }
  const parentVisible = values[toolStyleKey(parent.id, 'visible')];
  return parentVisible === undefined || parentVisible === true;
}

/** The Style tab: one row per style, in declaration order, children indented under their parent. */
export function StyleTab({ definitions, values, onChange }: StyleTabProps) {
  return (
    <div className="drawing-settings-style-list">
      {definitions.map((definition) => (
        <ToolStyleField
          key={definition.id}
          definition={definition}
          values={values}
          onChange={onChange}
          disabled={!isParentVisible(definitions, definition, values)}
        />
      ))}
    </div>
  );
}
