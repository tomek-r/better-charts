import { Fragment, useId } from 'react';
import {
  isSettingInputActive,
  isSettingInputInvalid,
  type SettingInputDefinition,
  type SettingValue,
  type SettingValues,
} from '../../engine/settings/settingInputs';
import {
  SettingBoolCheckbox,
  SettingInlineControl,
  SettingInputField,
  SettingInputTitle,
  SettingQuietTitle,
  type SettingFieldProps,
} from './SettingInputField';

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

/** Rows of one group: inputs sharing an `inline` key join the row of the first of them. */
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

/** What one input's field is given, from the draft it edits. */
function settingFieldProps(
  definition: SettingInputDefinition,
  { values, onChange }: FieldEditing,
  idPrefix: string,
): SettingFieldProps {
  return {
    definition,
    // The tab's prefix keeps two open forms from handing their labels the same ids.
    controlId: `${idPrefix}-${definition.id}`,
    value: values[definition.id],
    onChange: (value) => onChange(definition.id, value),
    disabled: !isSettingInputActive(definition, values),
    invalid: isSettingInputInvalid(definition, values),
  };
}

interface SettingsRowProps extends FieldEditing {
  readonly row: readonly SettingInputDefinition[];
  readonly idPrefix: string;
}

/**
 * One row of the tab: a single input with its title, or the inputs sharing an `inline` key on one line —
 * the first one's title in the label column, then every control beside it.
 */
function SettingsRow({ row, values, onChange, idPrefix }: SettingsRowProps) {
  const editing = { values, onChange };
  const fields = row.map((definition) => settingFieldProps(definition, editing, idPrefix));
  if (fields.length === 1) {
    return <SettingInputField {...fields[0]} />;
  }
  const [first, ...siblings] = fields;
  const firstIsCheckbox = first.definition.kind === 'bool';
  return (
    <div className="drawing-settings-inline-row">
      {firstIsCheckbox ? <SettingBoolCheckbox {...first} /> : <SettingInputTitle {...first} />}
      <div className="drawing-settings-inline-controls">
        {firstIsCheckbox ? null : <SettingInlineControl {...first} />}
        {siblings.map((field) => (
          <Fragment key={field.definition.id}>
            <SettingQuietTitle {...field} />
            <SettingInlineControl {...field} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

interface DrawingSettingsGroupProps extends FieldEditing {
  readonly group: DefinitionGroup;
  readonly idPrefix: string;
}

/** One group of fields: a fieldset with its legend, or a plain block while nothing names the group. */
function DrawingSettingsGroup({ group, values, onChange, idPrefix }: DrawingSettingsGroupProps) {
  const rows = inputRows(group.inputs).map((row) => (
    <SettingsRow key={row[0].id} row={row} values={values} onChange={onChange} idPrefix={idPrefix} />
  ));
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
  const idPrefix = useId();
  return (
    <div className="drawing-settings-inputs">
      {definitionGroups(definitions).map((group) => (
        <DrawingSettingsGroup
          key={group.legend ?? 'ungrouped'}
          group={group}
          values={values}
          onChange={onChange}
          idPrefix={idPrefix}
        />
      ))}
    </div>
  );
}
