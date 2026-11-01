import { OutlineIcon } from './OutlineIcon';

import './canvas-icon.css';

/** A pencil: the mark-making tool, the glyph the Canvas tab of the chart settings draws. */
export function CanvasIcon() {
  return (
    <OutlineIcon className="canvas-icon">
      <path d="M4.5 19.5 5.7 15 16.4 4.3a2.4 2.4 0 0 1 3.3 3.3L9 18.3l-4.5 1.2Z" />
      <path d="M14.6 6.1l3.3 3.3" />
    </OutlineIcon>
  );
}
