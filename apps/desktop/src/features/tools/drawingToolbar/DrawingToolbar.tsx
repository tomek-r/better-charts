import { useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react';
import { CommandButton } from '../../../shared/ui/button/CommandButton';
import { ToggleCommandButton } from '../../../shared/ui/button/ToggleCommandButton';
import { arrowStep, wrapIndex, type ArrowSteps } from '../../../shared/ui/keyboard/arrowStep';
import {
  DRAWING_LOCK_LABELS,
  DRAWING_SETTINGS_LABEL,
  DRAWING_VISIBILITY_LABELS,
  REMOVE_DRAWING_LABEL,
} from './drawingCommandLabels';
import {
  EyeCrossedIcon,
  EyeIcon,
  GripIcon,
  LockClosedIcon,
  LockOpenIcon,
  SettingsIcon,
  TrashIcon,
} from './drawingToolbarIcons';
import type { DrawingToolbarPosition, GripHandlers } from './useDrawingToolbarPosition';

/** Distance of the default position from the frame's top edge, in CSS px. */
const DEFAULT_TOP_INSET_PX = 12;
/** Arrow keys walk the buttons in reading order: right and left, with up and down as their vertical twins. */
const FOCUS_STEPS: ArrowSteps = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

const TOOLBAR_BUTTON_CLASS = 'drawing-toolbar-button';

/** The toolbar's buttons in reading order, which is also their order in the arrow-key walk. */
const BUTTON_ORDER = ['grip', 'settings', 'lock', 'visibility', 'remove'] as const;
type ToolbarButtonId = (typeof BUTTON_ORDER)[number];

/** The toolbar's place inside the chart frame; the default centres it over the top edge. */
function toolbarStyle(position: DrawingToolbarPosition): CSSProperties {
  if (position.anchor === 'dragged') {
    return { left: position.left, top: position.top };
  }
  return { left: '50%', top: DEFAULT_TOP_INSET_PX, transform: 'translateX(-50%)' };
}

export interface DrawingToolbarProps {
  readonly position: DrawingToolbarPosition;
  readonly locked: boolean;
  readonly visible: boolean;
  readonly gripHandlers: GripHandlers;
  /** Attaches the panel element the drag measures against the chart frame. */
  readonly panelRef: Ref<HTMLDivElement>;
  readonly onOpenSettings: () => void;
  readonly onToggleLock: () => void;
  readonly onToggleVisibility: () => void;
  readonly onRemove: () => void;
}

/**
 * The floating toolbar of the selected drawing: move, settings, lock, visibility and remove, in that
 * order. It is a WAI-ARIA toolbar with one tab stop, so Tab enters on the grip and the arrow keys walk
 * the buttons.
 */
export function DrawingToolbar({
  position,
  locked,
  visible,
  gripHandlers,
  panelRef,
  onOpenSettings,
  onToggleLock,
  onToggleVisibility,
  onRemove,
}: DrawingToolbarProps) {
  const [tabStopIndex, setTabStopIndex] = useState(0);
  /** 0 for the one button Tab reaches; every other button is reached with the arrow keys. */
  const tabStop = (button: ToolbarButtonId) => {
    const index = BUTTON_ORDER.indexOf(button);
    return {
      tabIndex: tabStopIndex === index ? 0 : -1,
      onFocus: () => setTabStopIndex(index),
    };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = arrowStep(event.key, FOCUS_STEPS);
    if (step === undefined) {
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const focusedIndex = buttons.indexOf(event.target as HTMLButtonElement);
    if (focusedIndex < 0) {
      return;
    }
    event.preventDefault();
    buttons[wrapIndex(focusedIndex, step, buttons.length)]?.focus();
  };

  return (
    <div
      ref={panelRef}
      role="toolbar"
      aria-label="Drawing toolbar"
      className="drawing-toolbar"
      style={toolbarStyle(position)}
      onKeyDown={onKeyDown}
    >
      <CommandButton
        label="Move toolbar"
        className={`${TOOLBAR_BUTTON_CLASS} drawing-toolbar-grip`}
        {...tabStop('grip')}
        {...gripHandlers}
      >
        <GripIcon />
      </CommandButton>
      <CommandButton
        label={DRAWING_SETTINGS_LABEL}
        className={TOOLBAR_BUTTON_CLASS}
        {...tabStop('settings')}
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </CommandButton>
      <ToggleCommandButton
        labels={DRAWING_LOCK_LABELS}
        offIcon={<LockOpenIcon />}
        onIcon={<LockClosedIcon />}
        pressed={locked}
        className={TOOLBAR_BUTTON_CLASS}
        {...tabStop('lock')}
        onClick={onToggleLock}
      />
      <ToggleCommandButton
        labels={DRAWING_VISIBILITY_LABELS}
        offIcon={<EyeIcon />}
        onIcon={<EyeCrossedIcon />}
        pressed={!visible}
        className={TOOLBAR_BUTTON_CLASS}
        {...tabStop('visibility')}
        onClick={onToggleVisibility}
      />
      <CommandButton
        label={REMOVE_DRAWING_LABEL}
        className={TOOLBAR_BUTTON_CLASS}
        {...tabStop('remove')}
        onClick={onRemove}
      >
        <TrashIcon />
      </CommandButton>
    </div>
  );
}
