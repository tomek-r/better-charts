import { OutlineIcon } from '../../../shared/ui/icons/OutlineIcon';

/** The class every toolbar glyph carries: drawing-toolbar.css sizes it for its 32 px button. */
const ICON_CLASS = 'drawing-toolbar-icon';

/** The grip's two dot columns and three dot rows, in the icon's 24 unit frame. */
const GRIP_DOT_COLUMNS = [9, 15];
const GRIP_DOT_ROWS = [6, 12, 18];

const GRIP_DOTS = (
  <>
    {GRIP_DOT_COLUMNS.map((cx) =>
      GRIP_DOT_ROWS.map((cy) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.2" fill="currentColor" stroke="none" />
      )),
    )}
  </>
);

const SETTINGS_GLYPH = (
  <>
    <path d="M12 2.8 19.5 7.1v9.8L12 21.2 4.5 16.9V7.1z" />
    <circle cx="12" cy="12" r="3.1" />
  </>
);

const LOCK_BODY = <rect x="4.5" y="10.5" width="15" height="9.5" rx="1.5" />;

const LOCK_CLOSED_GLYPH = (
  <>
    {LOCK_BODY}
    <path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" />
  </>
);

const LOCK_OPEN_GLYPH = (
  <>
    {LOCK_BODY}
    <path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0" />
  </>
);

/** An eye: the lens outline around a round pupil. */
const EYE_GLYPH = (
  <>
    <path d="M2.5 12s4-7.5 9.5-7.5 9.5 7.5 9.5 7.5-4 7.5-9.5 7.5-9.5-7.5-9.5-7.5z" />
    <circle cx="12" cy="12" r="2.9" />
  </>
);

/** The same eye crossed out: one diagonal cutting the outline from top-left to bottom-right. */
const EYE_CROSSED_GLYPH = (
  <>
    {EYE_GLYPH}
    <path d="M3.5 3.5 20.5 20.5" />
  </>
);

const TRASH_GLYPH = (
  <>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </>
);

/** The grip that drags the toolbar: six dots in two columns. */
export function GripIcon() {
  return <OutlineIcon className={ICON_CLASS}>{GRIP_DOTS}</OutlineIcon>;
}

/** Settings: a hexagon around a circle, the tool's typed inputs behind it. */
export function SettingsIcon() {
  return <OutlineIcon className={ICON_CLASS}>{SETTINGS_GLYPH}</OutlineIcon>;
}

/** The drawing accepts edit gestures. */
export function LockOpenIcon() {
  return <OutlineIcon className={ICON_CLASS}>{LOCK_OPEN_GLYPH}</OutlineIcon>;
}

/** The drawing ignores edit gestures. */
export function LockClosedIcon() {
  return <OutlineIcon className={ICON_CLASS}>{LOCK_CLOSED_GLYPH}</OutlineIcon>;
}

/** The drawing is shown; pressing the button hides it. */
export function EyeIcon() {
  return <OutlineIcon className={ICON_CLASS}>{EYE_GLYPH}</OutlineIcon>;
}

/** The drawing is hidden; pressing the button shows it again. */
export function EyeCrossedIcon() {
  return <OutlineIcon className={ICON_CLASS}>{EYE_CROSSED_GLYPH}</OutlineIcon>;
}

/** Removes the drawing. */
export function TrashIcon() {
  return <OutlineIcon className={ICON_CLASS}>{TRASH_GLYPH}</OutlineIcon>;
}
