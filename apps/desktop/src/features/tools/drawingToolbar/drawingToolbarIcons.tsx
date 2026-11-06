import { OutlineIcon } from '../../../shared/ui/icons/OutlineIcon';

/** The class every toolbar glyph carries: drawing-toolbar.css sizes it for its 32 px button. */
export const TOOLBAR_ICON_CLASS = 'drawing-toolbar-icon';

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

/** The grip that drags the toolbar: six dots in two columns. */
export function GripIcon() {
  return <OutlineIcon className={TOOLBAR_ICON_CLASS}>{GRIP_DOTS}</OutlineIcon>;
}
