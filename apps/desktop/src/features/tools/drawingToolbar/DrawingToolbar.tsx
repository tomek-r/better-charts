import { useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import {
  EyeCrossedIcon,
  EyeIcon,
  GripIcon,
  LockClosedIcon,
  LockOpenIcon,
  SettingsIcon,
  TrashIcon,
} from './drawingToolbarIcons';
import type { DrawingToolbarPosition, GripHandlers } from './useDraggablePosition';

/** Distance of the default position from the frame's top edge, in CSS px. */
const DEFAULT_TOP_INSET_PX = 12;
/** Arrow keys walk the buttons in reading order: right and left, with up and down as their vertical twins. */
const FOCUS_STEPS: Readonly<Partial<Record<string, number>>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The toolbar's place inside the chart frame; the default centres it over the top edge. */
function toolbarStyle(position: DrawingToolbarPosition): CSSProperties {
  if (position.anchor === 'dragged') {
    return { left: position.left, top: position.top };
  }
  return { left: '50%', top: DEFAULT_TOP_INSET_PX, transform: 'translateX(-50%)' };
}

interface ToolbarButtonProps {
  readonly label: string;
  /** 0 for the one button Tab reaches; every other button is reached with the arrow keys. */
  readonly tabIndex: number;
  readonly onFocus: () => void;
  readonly onClick: () => void;
  /** Only the toggles set it: their pressed state is the drawing's lock or its hidden flag. */
  readonly pressed?: boolean;
  readonly children: ReactNode;
}

function ToolbarButton({ label, tabIndex, onFocus, onClick, pressed, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="drawing-toolbar-button"
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      aria-pressed={pressed}
      onFocus={onFocus}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface ToolbarToggleButtonProps {
  /** What the button does and shows while the toggle is off. */
  readonly offLabel: string;
  readonly offIcon: ReactNode;
  /** What the button does and shows while the toggle is on. */
  readonly onLabel: string;
  readonly onIcon: ReactNode;
  readonly pressed: boolean;
  readonly tabIndex: number;
  readonly onFocus: () => void;
  readonly onClick: () => void;
}

/** A button that names the next command: one face while the toggle is off, another while it is on. */
function ToolbarToggleButton({
  offLabel,
  offIcon,
  onLabel,
  onIcon,
  pressed,
  tabIndex,
  onFocus,
  onClick,
}: ToolbarToggleButtonProps) {
  return (
    <ToolbarButton
      label={pressed ? onLabel : offLabel}
      pressed={pressed}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={onClick}
    >
      {pressed ? onIcon : offIcon}
    </ToolbarButton>
  );
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
  const tabStop = (index: number) => ({
    tabIndex: tabStopIndex === index ? 0 : -1,
    onFocus: () => setTabStopIndex(index),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = FOCUS_STEPS[event.key];
    if (step === undefined) {
      return;
    }
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const focusedIndex = buttons.indexOf(event.target as HTMLButtonElement);
    if (focusedIndex < 0) {
      return;
    }
    event.preventDefault();
    buttons[(focusedIndex + step + buttons.length) % buttons.length]?.focus();
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
      <button
        type="button"
        className="drawing-toolbar-button drawing-toolbar-grip"
        aria-label="Move toolbar"
        title="Move toolbar"
        {...tabStop(0)}
        {...gripHandlers}
      >
        <GripIcon />
      </button>
      <ToolbarButton label="Drawing settings" {...tabStop(1)} onClick={onOpenSettings}>
        <SettingsIcon />
      </ToolbarButton>
      <ToolbarToggleButton
        offLabel="Lock drawing"
        offIcon={<LockOpenIcon />}
        onLabel="Unlock drawing"
        onIcon={<LockClosedIcon />}
        pressed={locked}
        {...tabStop(2)}
        onClick={onToggleLock}
      />
      <ToolbarToggleButton
        offLabel="Hide drawing"
        offIcon={<EyeIcon />}
        onLabel="Show drawing"
        onIcon={<EyeCrossedIcon />}
        pressed={!visible}
        {...tabStop(3)}
        onClick={onToggleVisibility}
      />
      <ToolbarButton label="Remove drawing" {...tabStop(4)} onClick={onRemove}>
        <TrashIcon />
      </ToolbarButton>
    </div>
  );
}
