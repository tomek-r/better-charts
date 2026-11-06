import { OutlineIcon } from './OutlineIcon';
import './status-line-icon.css';

/** A status line: four stacked strokes, each shorter than the one above. */
export function StatusLineIcon() {
  return (
    <OutlineIcon className="status-line-icon">
      <path d="M3 5h18" />
      <path d="M3 10h15" />
      <path d="M3 15h12" />
      <path d="M3 20h9" />
    </OutlineIcon>
  );
}
