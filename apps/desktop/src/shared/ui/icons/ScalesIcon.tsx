import { OutlineIcon } from './OutlineIcon';

import './scales-icon.css';

/** An L-shaped price axis, an arrow head on each arm: the glyph the Scales and lines tab of the settings draws. */
export function ScalesIcon() {
  return (
    <OutlineIcon className="scales-icon">
      <path d="M7 19.5V4.5" />
      <path d="M4.6 7.1 7 4.5l2.4 2.6" />
      <path d="M6.5 19.5H20" />
      <path d="M17.4 17.1 20 19.5l-2.6 2.4" />
    </OutlineIcon>
  );
}
