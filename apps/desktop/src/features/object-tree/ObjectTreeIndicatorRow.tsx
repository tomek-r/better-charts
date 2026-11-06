import type { KeyboardEvent } from 'react';
import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { resolveSettingValues } from '../chart/engine/settings/settingsSchema';
import {
  INDICATOR_SETTINGS_LABEL,
  INDICATOR_VISIBILITY_LABELS,
  REMOVE_INDICATOR_LABEL,
} from '../chart/engine/legend/indicatorLegendLabels';
import { IndicatorLineIcon } from '../indicators/IndicatorLineIcon';
import { indicatorLegendTitle } from '../indicators/indicatorLegendTitle';
import { useOpenIndicatorSettings } from '../indicators/IndicatorSettingsProvider';
import type { RegisteredChartIndicatorPlugin } from '../indicators/registry';
import { useIndicatorCommands } from '../indicators/useIndicatorCommands';
import { CommandButton } from '../../shared/ui/button/CommandButton';
import { SettingsIcon } from '../../shared/ui/icons/SettingsIcon';
import {
  ObjectTreeRemoveButton,
  ObjectTreeVisibilityButton,
  ROW_ACTION_CLASS,
  ROW_ACTION_ICON_CLASS,
} from './objectTreeRowActions';
import { presentWhileTrue } from './objectTreeRowAttributes';
import { ROW_NAME_CLASS } from './objectTreeRowFocus';

export interface ObjectTreeIndicatorRowProps {
  readonly saved: SavedIndicator;
  /** The registry entry that drew the indicator: the row names it as the legend does and edits it. */
  readonly plugin: RegisteredChartIndicatorPlugin;
}

/**
 * One indicator of the object tree, named as the chart's legend names it. A double click opens its
 * settings and Delete or Backspace on its name detaches it, while the three small buttons beside it
 * open its settings, hide or show it and remove it.
 */
export function ObjectTreeIndicatorRow({ saved, plugin }: ObjectTreeIndicatorRowProps) {
  const openIndicatorSettings = useOpenIndicatorSettings();
  const commands = useIndicatorCommands();
  const name = indicatorLegendTitle(saved.definitionId, resolveSettingValues(plugin, saved.settings));
  const hidden = saved.hidden === true;

  const openSettings = () => openIndicatorSettings(saved.instanceId);
  const remove = () => commands.remove(saved.instanceId);
  const onNameKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    event.preventDefault();
    remove();
  };

  return (
    <li
      className="object-tree-row object-tree-indicator-row"
      data-instance-id={saved.instanceId}
      data-hidden={presentWhileTrue(hidden)}
    >
      <button type="button" className={ROW_NAME_CLASS} onDoubleClick={openSettings} onKeyDown={onNameKeyDown}>
        <IndicatorLineIcon className="object-tree-row-icon" />
        <span className="object-tree-row-label" title={name}>
          {name}
        </span>
      </button>
      <div className="object-tree-row-actions">
        <CommandButton className={ROW_ACTION_CLASS} label={INDICATOR_SETTINGS_LABEL} onClick={openSettings}>
          <SettingsIcon className={ROW_ACTION_ICON_CLASS} />
        </CommandButton>
        <ObjectTreeVisibilityButton
          labels={INDICATOR_VISIBILITY_LABELS}
          hidden={hidden}
          onToggle={() => commands.setHidden(saved.instanceId, !hidden)}
        />
        <ObjectTreeRemoveButton label={REMOVE_INDICATOR_LABEL} onRemove={remove} />
      </div>
    </li>
  );
}
