import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ChartDrawingRecord } from '../chart/engine/drawings/drawingRecord';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useOpenDrawingSettings } from '../tools/drawingSettings/DrawingSettingsProvider';
import { DrawingToolIcon } from '../tools/DrawingToolIcon';
import {
  DRAWING_LOCK_LABELS,
  DRAWING_VISIBILITY_LABELS,
  REMOVE_DRAWING_LABEL,
  type DrawingToggleLabels,
} from '../tools/drawingToolbar/drawingCommandLabels';
import {
  EyeCrossedIcon,
  EyeIcon,
  LockClosedIcon,
  LockOpenIcon,
  TrashIcon,
} from '../tools/drawingToolbar/drawingToolbarIcons';
import { CHART_TOOL_PLUGINS } from '../tools/registry';
import { ROW_NAME_CLASS, rowNameButtons } from './objectTreeRowFocus';
import type { LayerRowReorder } from './useLayerReorder';

/** The row glyph, sized like the floating toolbar's. */
const ROW_ICON_SIZE_PX = 18;

/** A data attribute that exists only while its condition holds, which is how object-tree.css selects it. */
function presentWhileTrue(holds: boolean): 'true' | undefined {
  return holds ? 'true' : undefined;
}

/**
 * Removes the row's drawing and hands focus to the row that takes its place, else to the row above it,
 * else to the list. The target is read before the delete, while the row is still in the list.
 */
function removeDrawingAndFocusRow(rowButton: HTMLButtonElement, removeDrawing: () => boolean): void {
  const rowButtons = rowNameButtons(rowButton.closest('ul'));
  const removedIndex = rowButtons.indexOf(rowButton);
  const nextFocusTarget = rowButtons[removedIndex + 1] ?? rowButtons[removedIndex - 1] ?? rowButton.closest('ul');
  if (!removeDrawing()) {
    return;
  }
  nextFocusTarget?.focus();
}

interface ObjectTreeActionButtonProps {
  readonly label: string;
  readonly onClick: () => void;
  /** Only the toggles set it: their pressed state is the drawing's lock or its hidden flag. */
  readonly pressed?: boolean;
  readonly children: ReactNode;
}

/** One small icon button of a row's actions. */
function ObjectTreeActionButton({ label, onClick, pressed, children }: ObjectTreeActionButtonProps) {
  return (
    <button
      type="button"
      className="object-tree-row-action"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface ObjectTreeToggleButtonProps {
  /** The command's two faces: what it does while its toggle is off, and what it does while it is on. */
  readonly labels: DrawingToggleLabels;
  readonly offIcon: ReactNode;
  readonly onIcon: ReactNode;
  readonly pressed: boolean;
  readonly onClick: () => void;
}

/** A row toggle: it shows the command that comes next and keeps the current state pressed. */
function ObjectTreeToggleButton({ labels, offIcon, onIcon, pressed, onClick }: ObjectTreeToggleButtonProps) {
  return (
    <ObjectTreeActionButton label={pressed ? labels.on : labels.off} pressed={pressed} onClick={onClick}>
      {pressed ? onIcon : offIcon}
    </ObjectTreeActionButton>
  );
}

export interface ObjectTreeRowProps {
  readonly record: ChartDrawingRecord;
  /** The registry entry that placed the drawing: the row names it and commands it through its id. */
  readonly plugin: (typeof CHART_TOOL_PLUGINS)[number];
  readonly selected: boolean;
  readonly reorder: LayerRowReorder;
}

/**
 * One drawing of the object tree: its name selects the drawing on the chart and a double click opens
 * its settings, while the three small buttons beside it lock, hide and remove it.
 */
export function ObjectTreeRow({ record, plugin, selected, reorder }: ObjectTreeRowProps) {
  const { chart } = useChartResources();
  const openDrawingSettings = useOpenDrawingSettings();
  const nameRef = useRef<HTMLButtonElement>(null);
  const selectDrawing = () => {
    chart.current?.drawings.select(plugin.id, record.id);
  };
  const removeDrawing = (): boolean => chart.current?.drawings.delete(plugin.id, record.id) ?? false;
  const removeAndFocusRow = () => {
    if (nameRef.current !== null) {
      removeDrawingAndFocusRow(nameRef.current, removeDrawing);
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
        onClick={selectDrawing}
        onDoubleClick={() => openDrawingSettings(plugin.id, record.id)}
        onKeyDown={onNameKeyDown}
      >
        <DrawingToolIcon name={plugin.id} size={ROW_ICON_SIZE_PX} className="object-tree-row-icon" />
        <span className="object-tree-row-label">{plugin.label}</span>
      </button>
      <div className="object-tree-row-actions">
        <ObjectTreeToggleButton
          labels={DRAWING_LOCK_LABELS}
          pressed={record.locked}
          offIcon={<LockOpenIcon />}
          onIcon={<LockClosedIcon />}
          onClick={() => chart.current?.drawings.setLocked(plugin.id, record.id, !record.locked)}
        />
        <ObjectTreeToggleButton
          labels={DRAWING_VISIBILITY_LABELS}
          pressed={!record.visible}
          offIcon={<EyeIcon />}
          onIcon={<EyeCrossedIcon />}
          onClick={() => chart.current?.drawings.setVisible(plugin.id, record.id, !record.visible)}
        />
        <ObjectTreeActionButton label={REMOVE_DRAWING_LABEL} onClick={removeAndFocusRow}>
          <TrashIcon />
        </ObjectTreeActionButton>
      </div>
    </li>
  );
}
