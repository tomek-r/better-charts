import { Fragment } from 'react';
import type { SettingValue, SettingValues } from '../../engine/settings/settingInputs';
import {
  settingStyleKey,
  type SettingStyleDefinition,
  type SettingStylePlotType,
} from '../../engine/settings/settingStyles';
import { PlotTypeButton } from './PlotTypeStyleField';
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

/** The plot types of the drawing, which are the only styles another style's row can draw. */
function plotTypesOf(definitions: readonly SettingStyleDefinition[]): readonly SettingStylePlotType[] {
  return definitions.filter((definition): definition is SettingStylePlotType => definition.kind === 'plotType');
}

/**
 * The plot types drawn on another style's row. One naming a style the drawing does not declare keeps its own
 * row, so its button is never lost.
 */
function inlinePlotTypesOf(definitions: readonly SettingStyleDefinition[]): readonly SettingStylePlotType[] {
  return plotTypesOf(definitions).filter((plotType) =>
    definitions.some((definition) => definition.id === plotType.inlineWithId),
  );
}

/** The inline plot types that name this style, and so belong on its row. */
function inlinePlotTypesOn(plotTypes: readonly SettingStylePlotType[], id: string): readonly SettingStylePlotType[] {
  return plotTypes.filter((plotType) => plotType.inlineWithId === id);
}

interface InlinePlotTypesProps {
  readonly definitions: readonly SettingStyleDefinition[];
  readonly plotTypes: readonly SettingStylePlotType[];
  readonly values: SettingValues;
  readonly onChange: (key: string, value: SettingValue) => void;
}

/** The Plot type buttons a row draws after its own controls, each switched off with the parent that hides it. */
function InlinePlotTypes({ definitions, plotTypes, values, onChange }: InlinePlotTypesProps) {
  return (
    <>
      {plotTypes.map((plotType) => (
        <PlotTypeButton
          key={plotType.id}
          definition={plotType}
          values={values}
          onChange={onChange}
          disabled={!isParentVisible(definitions, plotType, values)}
        />
      ))}
    </>
  );
}

/**
 * The Style tab: one row per style, in declaration order, children indented under their parent. A style
 * carrying a `section` prints its caption first, and the styles after it read as that group. A plot type drawn
 * on another style's row gets no row of its own.
 */
export function StyleTab({ definitions, values, onChange }: StyleTabProps) {
  const inlinePlotTypes = inlinePlotTypesOf(definitions);
  const inlinePlotTypeIds = new Set(inlinePlotTypes.map((plotType) => plotType.id));
  const rowDefinitions = definitions.filter((definition) => !inlinePlotTypeIds.has(definition.id));
  return (
    <div className="drawing-settings-style-list">
      {rowDefinitions.map((definition) => (
        <Fragment key={definition.id}>
          {definition.section === undefined ? null : (
            <h3 className="drawing-settings-style-section">{definition.section}</h3>
          )}
          <SettingStyleField
            definition={definition}
            values={values}
            onChange={onChange}
            disabled={!isParentVisible(definitions, definition, values)}
            trailing={
              <InlinePlotTypes
                definitions={definitions}
                plotTypes={inlinePlotTypesOn(inlinePlotTypes, definition.id)}
                values={values}
                onChange={onChange}
              />
            }
          />
        </Fragment>
      ))}
    </div>
  );
}
