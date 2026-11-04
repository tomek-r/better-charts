import {
  isSettingInputActive,
  isSettingInputInvalid,
  type SettingInputDefinition,
  type SettingValue,
  type SettingValues,
} from '../../../chart/engine/settings/settingInputs';
import { SettingInputField } from './SettingInputField';

/** The inputs sharing one group, or the ungrouped ones; `legend` is undefined for those. */
interface DefinitionGroup {
  readonly legend: string | undefined;
  readonly inputs: readonly SettingInputDefinition[];
}

/** Ungrouped inputs first, then each named group in the order its first input declares it. */
function definitionGroups(definitions: readonly SettingInputDefinition[]): DefinitionGroup[] {
  const ungrouped = definitions.filter((definition) => definition.group === undefined);
  const grouped = new Map<string, SettingInputDefinition[]>();
  for (const definition of definitions) {
    if (definition.group === undefined) {
      continue;
    }
    grouped.set(definition.group, [...(grouped.get(definition.group) ?? []), definition]);
  }
  const named = [...grouped].map(([legend, inputs]) => ({ legend, inputs }));
  return ungrouped.length === 0 ? named : [{ legend: undefined, inputs: ungrouped }, ...named];
}

/** Rows of one group: inputs sharing an `inline` key join the row of the first of them, as in Pine. */
function inputRows(inputs: readonly SettingInputDefinition[]): SettingInputDefinition[][] {
  const rows: SettingInputDefinition[][] = [];
  const inlineRows = new Map<string, SettingInputDefinition[]>();
  for (const input of inputs) {
    const sharedRow = input.inline === undefined ? undefined : inlineRows.get(input.inline);
    if (sharedRow !== undefined) {
      sharedRow.push(input);
      continue;
    }
    const row = [input];
    rows.push(row);
    if (input.inline !== undefined) {
      inlineRows.set(input.inline, row);
    }
  }
  return rows;
}

interface FieldEditing {
  readonly values: SettingValues;
  readonly onChange: (id: string, value: SettingValue) => void;
}

interface InputsTabProps extends FieldEditing {
  readonly definitions: readonly SettingInputDefinition[];
}

interface DrawingSettingsGroupProps extends FieldEditing {
  readonly group: DefinitionGroup;
}

/** One group of fields: a fieldset with its legend, or a plain block while nothing names the group. */
function DrawingSettingsGroup({ group, values, onChange }: DrawingSettingsGroupProps) {
  const renderField = (definition: SettingInputDefinition) => (
    <SettingInputField
      key={definition.id}
      definition={definition}
      value={values[definition.id]}
      onChange={(value) => onChange(definition.id, value)}
      disabled={!isSettingInputActive(definition, values)}
      invalid={isSettingInputInvalid(definition, values)}
    />
  );
  const rows = inputRows(group.inputs).map((row) =>
    row.length === 1 ? (
      renderField(row[0])
    ) : (
      <div key={row[0].id} className="drawing-settings-inline-row">
        {row.map(renderField)}
      </div>
    ),
  );
  if (group.legend === undefined) {
    return <div className="drawing-settings-group">{rows}</div>;
  }
  return (
    <fieldset className="drawing-settings-group">
      <legend>{group.legend}</legend>
      {rows}
    </fieldset>
  );
}

/** The Inputs tab: one field per input, grouped and laid out in rows as the definitions ask. */
export function InputsTab({ definitions, values, onChange }: InputsTabProps) {
  return definitionGroups(definitions).map((group) => (
    <DrawingSettingsGroup key={group.legend ?? 'ungrouped'} group={group} values={values} onChange={onChange} />
  ));
}
