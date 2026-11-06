import { OutlineIcon } from './OutlineIcon';

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

/** The drawing accepts edit gestures. */
export function LockOpenIcon({ className }: { className: string }) {
  return <OutlineIcon className={className}>{LOCK_OPEN_GLYPH}</OutlineIcon>;
}

/** The drawing ignores edit gestures. */
export function LockClosedIcon({ className }: { className: string }) {
  return <OutlineIcon className={className}>{LOCK_CLOSED_GLYPH}</OutlineIcon>;
}

/** The drawing is shown; pressing the button hides it. */
export function EyeIcon({ className }: { className: string }) {
  return <OutlineIcon className={className}>{EYE_GLYPH}</OutlineIcon>;
}

/** The drawing is hidden; pressing the button shows it again. */
export function EyeCrossedIcon({ className }: { className: string }) {
  return <OutlineIcon className={className}>{EYE_CROSSED_GLYPH}</OutlineIcon>;
}

/** Removes the drawing. */
export function TrashIcon({ className }: { className: string }) {
  return <OutlineIcon className={className}>{TRASH_GLYPH}</OutlineIcon>;
}
