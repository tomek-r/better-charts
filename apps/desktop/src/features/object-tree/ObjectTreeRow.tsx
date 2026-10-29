import { useRef, type KeyboardEvent } from 'react';
import type { ChartDrawingRecord } from '../chart/engine/drawings/drawingRecord';
import { CommandButton } from '../../shared/ui/button/CommandButton';
import { ToggleCommandButton } from '../../shared/ui/button/ToggleCommandButton';
import { useOpenDrawingSettings } from '../tools/drawingSettings/DrawingSettingsProvider';
import { DrawingToolIcon } from '../tools/DrawingToolIcon';
import {
  DRAWING_LOCK_LABELS,
  DRAWING_SETTINGS_LABEL,
  DRAWING_VISIBILITY_LABELS,
  REMOVE_DRAWING_LABEL,
} from '../tools/drawingToolbar/drawingCommandLabels';
import {
  EyeCrossedIcon,
  EyeIcon,
  LockClosedIcon,
  LockOpenIcon,
  SettingsIcon,
  TrashIcon,
} from '../tools/drawingToolbar/drawingToolbarIcons';
import type { RegisteredChartToolPlugin } from '../tools/registry';
import { useDrawingCommands } from '../tools/useDrawingCommands';
import { ROW_NAME_CLASS, rowNameButtons } from './objectTreeRowFocus';
import type { LayerRowReorder } from './useLayerReorder';

/** The row glyph, sized like the floating toolbar's. */
const ROW_ICON_SIZE_PX = 18;

/** The class of the small icon buttons of a row's actions. */
const ROW_ACTION_CLASS = 'object-tree-row-action';

/** A data attribute that exists only while its condition holds, which is how object-tree.css selects it. */
function presentWhileTrue(holds: boolean): 'true' | undefined {
  return holds ? 'true' : undefined;
}

export interface ObjectTreeRowProps {
  readonly record: ChartDrawingRecord;
  /** The registry entry that placed the drawing: the row names it and commands it through its id. */
  readonly plugin: RegisteredChartToolPlugin;
  readonly selected: boolean;
  readonly reorder: LayerRowReorder;
}

/**
 * One drawing of the object tree: its name selects the drawing on the chart and a double click opens
 * its settings, while the four small buttons beside it open its settings, lock, hide and remove it.
 */
export function ObjectTreeRow({ record, plugin, selected, reorder }: ObjectTreeRowProps) {
  const openDrawingSettings = useOpenDrawingSettings();
  const commands = useDrawingCommands(plugin.id, record.id);
  const nameRef = useRef<HTMLButtonElement>(null);
  /**
   * Removes the row's drawing and hands focus to the row that takes its place, else to the row above it,
   * else to the list. The target is read before the delete, while the row is still in the list.
   */
  const removeAndFocusRow = () => {
    const rowButton = nameRef.current;
    if (rowButton === null) {
      return;
    }
    const rowButtons = rowNameButtons(rowButton.closest('ul'));
    const removedIndex = rowButtons.indexOf(rowButton);
    const nextFocusTarget = rowButtons[removedIndex + 1] ?? rowButtons[removedIndex - 1] ?? rowButton.closest('ul');
    if (commands.remove()) {
      nextFocusTarget?.focus();
    }
  };
  const onNameKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeAndFocusRow();
      return;
    }
    reorder.onNameKeyDown(event);
  };

  return (
    <li
      className="object-tree-row"
      data-drawing-id={record.id}
      data-selected={presentWhileTrue(selected)}
      data-hidden={presentWhileTrue(!record.visible)}
      {...reorder.listItemProps}
    >
      <button
        ref={nameRef}
        type="button"
        className={ROW_NAME_CLASS}
        aria-current={presentWhileTrue(selected)}
        onClick={commands.select}
        onDoubleClick={() => openDrawingSettings(plugin.id, record.id)}
        onKeyDown={onNameKeyDown}
      >
        <DrawingToolIcon name={plugin.id} size={ROW_ICON_SIZE_PX} className="object-tree-row-icon" />
        <span className="object-tree-row-label" title={plugin.label}>
          {plugin.label}
        </span>
      </button>
      <div className="object-tree-row-actions">
        <CommandButton
          className={ROW_ACTION_CLASS}
          label={DRAWING_SETTINGS_LABEL}
          onClick={() => openDrawingSettings(plugin.id, record.id)}
        >
          <SettingsIcon />
        </CommandButton>
        <ToggleCommandButton
          className={ROW_ACTION_CLASS}
          labels={DRAWING_LOCK_LABELS}
          pressed={record.locked}
          offIcon={<LockOpenIcon />}
          onIcon={<LockClosedIcon />}
          onClick={() => commands.setLocked(!record.locked)}
        />
        <ToggleCommandButton
          className={ROW_ACTION_CLASS}
          labels={DRAWING_VISIBILITY_LABELS}
          pressed={!record.visible}
          offIcon={<EyeIcon />}
          onIcon={<EyeCrossedIcon />}
          onClick={() => commands.setVisible(!record.visible)}
        />
        <CommandButton className={ROW_ACTION_CLASS} label={REMOVE_DRAWING_LABEL} onClick={removeAndFocusRow}>
          <TrashIcon />
        </CommandButton>
      </div>
    </li>
  );
}
